-- ============================================================
-- FIX: "column status is of type lot_status but expression is of type text"
--
-- Al aprobar el traspaso, el estado del lote del vendedor se calcula así:
--   status = case when v_resto <= 0 then 'cerrado' else 'activo' end
--
-- Un literal suelto ('activo') Postgres lo convierte solo al tipo lot_status,
-- pero el resultado de un CASE ya es texto y NO lo convierte solo. Hay que
-- pedirlo explícitamente con ::lot_status.
--
-- El error no aparecía al crear la función porque el cuerpo de una función
-- plpgsql no se revisa hasta que se ejecuta. Por eso recién salta al aprobar.
--
-- Correr DESPUÉS de traspaso_lote_repetido.sql. Idempotente.
-- ============================================================

create or replace function public.approve_transfer_operation(
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role    text;
  v_name    text;
  v_op      public.transfer_operations%rowtype;
  v_it      public.lot_transfers%rowtype;
  v_lot     public.lots%rowtype;
  v_dest    public.lots%rowtype;
  v_new_lot uuid;
  v_code    text;
  v_resto   numeric(12, 2);
  v_prev    numeric(12, 2);
  v_from    text;
  v_to      text;
  v_count   integer := 0;
begin
  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede aprobar un traspaso.';
  end if;

  select * into v_op from public.transfer_operations where id = p_operation_id for update;
  if not found then
    raise exception 'Traspaso no encontrado.';
  end if;
  if v_op.status <> 'pendiente' then
    raise exception 'Este traspaso ya fue %.', v_op.status;
  end if;

  select name into v_from from public.clients where id = v_op.from_client_id;
  select name into v_to   from public.clients where id = v_op.to_client_id;

  update public.transfer_operations
  set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now()
  where id = v_op.id;

  for v_it in select * from public.lot_transfers where operation_id = v_op.id
  loop
    v_count := v_count + 1;

    select * into v_lot from public.lots where id = v_it.lot_id for update;
    if not found then
      raise exception 'Un lote del traspaso ya no existe.';
    end if;
    if v_it.quantity > coalesce(v_lot.current_quantity, 0) then
      raise exception 'El lote % ya no tiene stock suficiente. Rechazá el traspaso.', v_lot.lot_code;
    end if;

    v_resto := v_lot.current_quantity - v_it.quantity;

    v_code := public.resolve_client_product_code(
      v_op.to_client_id, v_lot.product, v_lot.package_size, v_lot.package_unit
    );

    -- ¿El comprador ya tiene ese mismo lote? Entonces se le suma.
    select * into v_dest
    from public.lots
    where client_id = v_op.to_client_id
      and lot_code = v_lot.lot_code
    for update;

    if found then
      v_prev := coalesce(v_dest.current_quantity, 0);
      update public.lots
      set current_quantity = v_prev + v_it.quantity,
          status = 'activo'::lot_status,
          updated_at = now()
      where id = v_dest.id;
      v_new_lot := v_dest.id;
    else
      v_prev := 0;
      insert into public.lots (
        lot_code, client_id, product, current_quantity,
        package_size, package_unit, location, entry_date, expiry_date,
        status, low_stock_threshold, inventory_source, solucion_product_code,
        solucion_warehouse_code, entry_boxes, entry_units_per_box, entry_loose_units
      ) values (
        v_lot.lot_code, v_op.to_client_id, v_lot.product, v_it.quantity,
        v_lot.package_size, v_lot.package_unit, v_lot.location, current_date, v_lot.expiry_date,
        'activo'::lot_status, v_lot.low_stock_threshold, v_lot.inventory_source, v_code,
        v_lot.solucion_warehouse_code, v_lot.entry_boxes, v_lot.entry_units_per_box, v_lot.entry_loose_units
      )
      returning id into v_new_lot;
    end if;

    insert into public.movements (
      lot_id, type, quantity, previous_quantity, new_quantity,
      from_location, to_location, notes, user_id
    ) values (
      v_lot.id, 'traspaso', v_it.quantity, v_lot.current_quantity, v_resto,
      v_lot.location, v_lot.location,
      concat('Traspaso a ', coalesce(v_to, 'otra empresa'), ' | ', v_op.notes),
      auth.uid()
    );

    insert into public.movements (
      lot_id, type, quantity, previous_quantity, new_quantity,
      from_location, to_location, notes, user_id
    ) values (
      v_new_lot, 'traspaso', v_it.quantity, v_prev, v_prev + v_it.quantity,
      v_lot.location, v_lot.location,
      concat('Traspaso desde ', coalesce(v_from, 'otra empresa'), ' | ', v_op.notes),
      auth.uid()
    );

    -- El CASE devuelve texto: hay que convertirlo al tipo del campo
    update public.lots
    set current_quantity = v_resto,
        status = (case when v_resto <= 0 then 'cerrado' else 'activo' end)::lot_status,
        updated_at = now()
    where id = v_lot.id;

    update public.lot_transfers
    set status = 'aprobado', new_lot_id = v_new_lot,
        reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now()
    where id = v_it.id;
  end loop;

  return jsonb_build_object('operation_id', v_op.id, 'items', v_count, 'from', v_from, 'to', v_to);
end;
$$;

grant execute on function public.approve_transfer_operation(uuid) to authenticated;

-- Mismo cuidado en el rechazo (ahí es un literal suelto, pero se deja explícito)
create or replace function public.reject_transfer_operation(
  p_operation_id uuid,
  p_reason       text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_name text;
  v_op   public.transfer_operations%rowtype;
begin
  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede rechazar un traspaso.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribí por qué se rechaza el traspaso.';
  end if;

  select * into v_op from public.transfer_operations where id = p_operation_id for update;
  if not found then
    raise exception 'Traspaso no encontrado.';
  end if;
  if v_op.status <> 'pendiente' then
    raise exception 'Este traspaso ya fue %.', v_op.status;
  end if;

  update public.transfer_operations
  set status = 'rechazado', reviewed_by = auth.uid(), reviewed_by_name = v_name,
      reviewed_at = now(), review_notes = btrim(p_reason)
  where id = v_op.id;

  update public.lot_transfers set status = 'rechazado' where operation_id = v_op.id;

  update public.lots set status = 'activo'::lot_status, updated_at = now()
  where id in (select lot_id from public.lot_transfers where operation_id = v_op.id)
    and status = 'retenido'::lot_status;

  return jsonb_build_object('operation_id', v_op.id, 'status', 'rechazado');
end;
$$;

grant execute on function public.reject_transfer_operation(uuid, text) to authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select lot_code, client_id, current_quantity, status from public.lots
--  where lot_code in ('65146','1461') order by lot_code, client_id;
