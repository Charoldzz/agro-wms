-- ============================================================
-- EL MISMO LOTE PUEDE ESTAR EN DOS EMPRESAS
--
-- Problema: al aprobar un traspaso fallaba con
--   duplicate key value violates unique constraint "lots_lot_code_key"
--
-- Causa: `lots.lot_code` era UNIQUE en TODA la tabla. Eso da por sentado que
-- un número de lote existe una sola vez en el depósito, y no es cierto: el
-- lote 25RFS0136 del fabricante puede estar guardado para dos clientes a la
-- vez. Es la misma mercadería física repartida entre dos dueños, no un
-- duplicado. Al traspasar, el comprador recibe el MISMO lote real (que es lo
-- correcto: el número de lote lo pone el fabricante, no nosotros) y chocaba.
--
-- Se arreglan dos cosas:
--   1) La restricción pasa a ser por EMPRESA: un cliente no puede tener dos
--      veces el mismo lote, pero dos clientes sí pueden tener el mismo.
--   2) Al aprobar, si el comprador YA tiene ese lote, se le SUMA la cantidad
--      en vez de crear otra fila. Es lo correcto en depósito: mismo producto,
--      mismo lote y mismo vencimiento es el mismo stock, solo que más.
--      Además cubre el caso de devolución (A le pasa a B y B le devuelve a A).
--
-- Correr DESPUÉS de traspaso_operacion.sql. Idempotente.
-- ============================================================

-- 1) Unicidad por empresa, no global
alter table public.lots drop constraint if exists lots_lot_code_key;

create unique index if not exists lots_client_lot_code_key
  on public.lots (client_id, lot_code);

-- 2) Al aprobar: sumar si ya existe, crear si no
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

  -- Aprobado ANTES de mover stock: así el candado deja pasar los movimientos
  -- de este mismo traspaso.
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

    -- Código del producto en el catálogo del comprador
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
          status = 'activo',
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
        'activo', v_lot.low_stock_threshold, v_lot.inventory_source, v_code,
        v_lot.solucion_warehouse_code, v_lot.entry_boxes, v_lot.entry_units_per_box, v_lot.entry_loose_units
      )
      returning id into v_new_lot;
    end if;

    -- Movimiento INTERNO en los dos lados (no es salida ni entrada)
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

    update public.lots
    set current_quantity = v_resto,
        status = case when v_resto <= 0 then 'cerrado' else 'activo' end,
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

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select lot_code, client_id, current_quantity, status from public.lots
--  where lot_code in ('65146','1461') order by lot_code;
