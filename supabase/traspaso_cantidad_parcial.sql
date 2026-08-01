-- ============================================================
-- TRASPASO PARCIAL: elegir cuánto se traspasa
--
-- Antes el traspaso pasaba SIEMPRE todo el stock del lote. Ahora el operador
-- carga la cantidad en equivalente (lts/kgs) y puede pasar una parte.
--
-- Decisión importante: aunque el traspaso sea PARCIAL, el lote queda
-- congelado ENTERO hasta que el admin resuelva. Si se dejara operar el resto,
-- alguien podría despachar el sobrante y al aprobar ya no habría stock
-- suficiente para cumplir el traspaso.
--
-- Correr DESPUÉS de traspaso_entre_clientes.sql. Idempotente.
-- ============================================================

-- La firma cambia (suma p_quantity), así que se elimina la versión vieja.
drop function if exists public.request_lot_transfer(uuid, uuid, text);

create or replace function public.request_lot_transfer(
  p_lot_id       uuid,
  p_to_client_id uuid,
  p_notes        text,
  p_quantity     numeric default null   -- null = todo el stock
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_name text;
  v_lot  public.lots%rowtype;
  v_qty  numeric(12, 2);
  v_id   uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('administrador', 'operador') then
    raise exception 'No tenés permiso para registrar un traspaso.';
  end if;

  if coalesce(btrim(p_notes), '') = '' then
    raise exception 'Escribí el motivo del traspaso (por ejemplo: venta de A a B).';
  end if;

  select * into v_lot from public.lots where id = p_lot_id for update;
  if not found then
    raise exception 'Lote no encontrado.';
  end if;

  if v_lot.status <> 'activo' then
    raise exception 'El lote no está activo (está %). No se puede traspasar.', v_lot.status;
  end if;

  if coalesce(v_lot.current_quantity, 0) <= 0 then
    raise exception 'El lote no tiene stock para traspasar.';
  end if;

  -- Sin cantidad = se traspasa todo
  v_qty := coalesce(p_quantity, v_lot.current_quantity);

  if v_qty <= 0 then
    raise exception 'La cantidad a traspasar debe ser mayor a cero.';
  end if;

  if v_qty > v_lot.current_quantity then
    raise exception 'No podés traspasar % si el lote tiene %.',
      trim(to_char(v_qty, 'FM999999990.99')),
      trim(to_char(v_lot.current_quantity, 'FM999999990.99'));
  end if;

  if p_to_client_id is null then
    raise exception 'Elegí la empresa que recibe el lote.';
  end if;

  if p_to_client_id = v_lot.client_id then
    raise exception 'El lote ya es de esa empresa.';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_to_client_id) then
    raise exception 'La empresa que recibe no existe.';
  end if;

  if exists (select 1 from public.lot_transfers t
             where t.lot_id = p_lot_id and t.status = 'pendiente') then
    raise exception 'Este lote ya tiene un traspaso esperando aprobación.';
  end if;

  insert into public.lot_transfers (
    lot_id, from_client_id, to_client_id, lot_code, product,
    quantity, notes, created_by, created_by_name
  ) values (
    v_lot.id, v_lot.client_id, p_to_client_id, v_lot.lot_code, v_lot.product,
    v_qty, btrim(p_notes), auth.uid(), v_name
  )
  returning id into v_id;

  -- Se congela el lote COMPLETO aunque el traspaso sea parcial (ver arriba).
  update public.lots
  set status = 'retenido', updated_at = now()
  where id = v_lot.id;

  return jsonb_build_object('id', v_id, 'lot_id', v_lot.id, 'quantity', v_qty, 'status', 'pendiente');
end;
$$;

grant execute on function public.request_lot_transfer(uuid, uuid, text, numeric) to authenticated;

-- ── Aprobar: ahora contempla el traspaso parcial ────────────
create or replace function public.approve_lot_transfer(
  p_transfer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role     text;
  v_name     text;
  v_t        public.lot_transfers%rowtype;
  v_lot      public.lots%rowtype;
  v_new_lot  uuid;
  v_qty      numeric(12, 2);
  v_resto    numeric(12, 2);
  v_from     text;
  v_to       text;
begin
  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede aprobar un traspaso.';
  end if;

  select * into v_t from public.lot_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Traspaso no encontrado.';
  end if;
  if v_t.status <> 'pendiente' then
    raise exception 'Este traspaso ya fue %.', v_t.status;
  end if;

  select * into v_lot from public.lots where id = v_t.lot_id for update;
  if not found then
    raise exception 'El lote del traspaso ya no existe.';
  end if;

  v_qty := coalesce(v_t.quantity, 0);
  if v_qty <= 0 then
    raise exception 'El traspaso no tiene cantidad. Rechazalo.';
  end if;
  if v_qty > coalesce(v_lot.current_quantity, 0) then
    raise exception 'El lote ya no tiene stock suficiente (quedan %). Rechazá el traspaso.',
      trim(to_char(coalesce(v_lot.current_quantity, 0), 'FM999999990.99'));
  end if;

  v_resto := v_lot.current_quantity - v_qty;

  select name into v_from from public.clients where id = v_t.from_client_id;
  select name into v_to   from public.clients where id = v_t.to_client_id;

  -- Se marca aprobado ANTES de mover stock para que el candado deje pasar
  -- los dos movimientos de este mismo traspaso.
  update public.lot_transfers
  set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name,
      reviewed_at = now()
  where id = v_t.id;

  -- Lote del comprador: misma mercadería, mismo lote real, mismo vencimiento
  -- y misma ubicación. Solo cambia el dueño (y la cantidad traspasada).
  insert into public.lots (
    lot_code, client_id, product, current_quantity,
    package_size, package_unit, location, entry_date, expiry_date,
    status, low_stock_threshold, inventory_source, solucion_product_code,
    solucion_warehouse_code, entry_boxes, entry_units_per_box, entry_loose_units
  ) values (
    v_lot.lot_code, v_t.to_client_id, v_lot.product, v_qty,
    v_lot.package_size, v_lot.package_unit, v_lot.location, current_date, v_lot.expiry_date,
    'activo', v_lot.low_stock_threshold, v_lot.inventory_source, v_lot.solucion_product_code,
    v_lot.solucion_warehouse_code, v_lot.entry_boxes, v_lot.entry_units_per_box, v_lot.entry_loose_units
  )
  returning id into v_new_lot;

  -- Salida del vendedor
  insert into public.movements (
    lot_id, type, quantity, previous_quantity, new_quantity,
    from_location, to_location, notes, user_id
  ) values (
    v_lot.id, 'salida', v_qty, v_lot.current_quantity, v_resto,
    v_lot.location, v_lot.location,
    concat('Traspaso a ', coalesce(v_to, 'otra empresa'), ' | ', v_t.notes),
    auth.uid()
  );

  -- Ingreso al comprador
  insert into public.movements (
    lot_id, type, quantity, previous_quantity, new_quantity,
    from_location, to_location, notes, user_id
  ) values (
    v_new_lot, 'entrada', v_qty, 0, v_qty,
    v_lot.location, v_lot.location,
    concat('Traspaso desde ', coalesce(v_from, 'otra empresa'), ' | ', v_t.notes),
    auth.uid()
  );

  -- Si se traspasó TODO, el lote del vendedor queda cerrado. Si fue parcial,
  -- se descuenta y vuelve a quedar operativo con el resto.
  update public.lots
  set current_quantity = v_resto,
      status = case when v_resto <= 0 then 'cerrado' else 'activo' end,
      updated_at = now()
  where id = v_lot.id;

  update public.lot_transfers set new_lot_id = v_new_lot where id = v_t.id;

  return jsonb_build_object(
    'transfer_id', v_t.id,
    'new_lot_id',  v_new_lot,
    'quantity',    v_qty,
    'resto',       v_resto,
    'from',        v_from,
    'to',          v_to
  );
end;
$$;

grant execute on function public.approve_lot_transfer(uuid) to authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select lot_code, product, quantity, status, notes from public.lot_transfers order by created_at desc;
