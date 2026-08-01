-- ============================================================
-- TRASPASO COMO OPERACIÓN INTERNA (rediseño)
--
-- Qué cambia respecto de la primera versión:
--   1) Es una OPERACIÓN con varios lotes (antes era lote por lote).
--   2) Es un movimiento INTERNO con tipo propio 'traspaso' — NO se registra
--      como salida + entrada. Motivo: la mercadería no cruza la puerta del
--      depósito. El stock de cada cliente cambia, pero el total del galpón
--      no. Registrarlo como salida/entrada falsearía los totales de
--      movimiento y le mostraría al vendedor un "despacho" que nunca ocurrió.
--   3) El código del producto se resuelve en el catálogo del COMPRADOR: el
--      código lleva el prefijo de cada empresa, así que no se puede heredar
--      el del vendedor.
--
-- Reglas acordadas con Harold:
--   · Lo registra el operador; SIEMPRE lo aprueba un administrador.
--   · Mientras espera, TODOS los lotes de la operación quedan congelados.
--   · Si la empresa que recibe no tiene código de empresa, se bloquea.
--   · Sin documento imprimible por ahora: queda en el sistema y en el portal.
--
-- Correr DESPUÉS de traspaso_entre_clientes.sql y traspaso_cantidad_parcial.sql
-- Idempotente.
-- ============================================================

-- ── 1) Tipo de movimiento propio ────────────────────────────
-- Si esto da "unsafe use of new value", corré SOLO esta línea, y después el
-- resto del archivo por separado.
alter type movement_type add value if not exists 'traspaso';

-- ── 2) Cabecera de la operación ─────────────────────────────
create table if not exists public.transfer_operations (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  operation_code   text,
  from_client_id   uuid not null references public.clients(id),
  to_client_id     uuid not null references public.clients(id),
  notes            text not null,
  status           text not null default 'pendiente'
                   check (status in ('pendiente', 'aprobado', 'rechazado')),
  created_by       uuid references auth.users(id) on delete set null,
  created_by_name  text,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  review_notes     text
);

create index if not exists transfer_operations_status_idx
  on public.transfer_operations (status, created_at desc);

-- Los ítems son los lot_transfers, ahora colgados de una operación
alter table public.lot_transfers
  add column if not exists operation_id uuid references public.transfer_operations(id) on delete cascade;

create index if not exists lot_transfers_operation_idx
  on public.lot_transfers (operation_id);

-- ── 3) El candado, ahora por operación ──────────────────────
create or replace function public.block_movements_on_pending_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.lot_transfers t
    left join public.transfer_operations o on o.id = t.operation_id
    where t.lot_id = new.lot_id
      and coalesce(o.status, t.status) = 'pendiente'
  ) then
    raise exception 'Este lote está en un traspaso y espera la aprobación del administrador. No se puede operar hasta que se apruebe o se rechace.';
  end if;
  return new;
end;
$$;

-- ── 4) Código del producto en el catálogo del COMPRADOR ─────
-- Si el comprador ya tiene el producto, se usa SU código. Si no, se le crea
-- la ficha con su prefijo, ya aprobada: los datos vienen de una ficha
-- validada del vendedor y el momento de revisión es la aprobación del
-- traspaso. Si quedara pendiente, el comprador no vería su propia mercadería.
create or replace function public.resolve_client_product_code(
  p_client_id uuid,
  p_product   text,
  p_size      numeric,
  p_unit      text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code   text;
  v_prefix text;
  v_next   integer;
begin
  -- ¿Ya lo tiene en su catálogo? (mismo nombre)
  select code into v_code
  from public.product_catalog
  where client_id = p_client_id
    and upper(btrim(name)) = upper(btrim(p_product))
  limit 1;

  if v_code is not null then
    return v_code;
  end if;

  select product_code_prefix into v_prefix
  from public.clients where id = p_client_id;

  if coalesce(btrim(v_prefix), '') = '' then
    raise exception 'La empresa que recibe no tiene código de empresa asignado. Cargalo en Empresas antes de traspasar.';
  end if;

  -- Siguiente número de esa empresa
  select coalesce(max(nullif(regexp_replace(code, '^.*-', ''), '')::integer), 0) + 1
  into v_next
  from public.product_catalog
  where client_id = p_client_id
    and code ~ ('^' || v_prefix || '-\d+$');

  v_code := v_prefix || '-' || lpad(v_next::text, 5, '0');

  insert into public.product_catalog (client_id, code, name, package_size, package_unit, pending_review)
  values (p_client_id, v_code, btrim(p_product), p_size, p_unit, false);

  return v_code;
end;
$$;

-- ── 5) Pedir el traspaso (operador o admin) ─────────────────
-- p_items: [{ "lot_id": "...", "quantity": 500 }, ...]
create or replace function public.request_transfer_operation(
  p_from_client_id uuid,
  p_to_client_id   uuid,
  p_notes          text,
  p_items          jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role   text;
  v_name   text;
  v_op     uuid;
  v_item   jsonb;
  v_lot    public.lots%rowtype;
  v_qty    numeric(12, 2);
  v_count  integer := 0;
  v_prefix text;
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
    raise exception 'Escribí el motivo del traspaso.';
  end if;

  if p_from_client_id is null or p_to_client_id is null then
    raise exception 'Elegí la empresa que vende y la que recibe.';
  end if;

  if p_from_client_id = p_to_client_id then
    raise exception 'La empresa que vende y la que recibe no pueden ser la misma.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un lote al traspaso.';
  end if;

  -- Se valida el código de empresa ACÁ, no al aprobar: así el operador se
  -- entera al instante y no pierde todo lo que cargó.
  select product_code_prefix into v_prefix from public.clients where id = p_to_client_id;
  if coalesce(btrim(v_prefix), '') = '' then
    raise exception 'La empresa que recibe no tiene código de empresa asignado. Un administrador debe cargarlo en Empresas antes de traspasar.';
  end if;

  insert into public.transfer_operations (
    operation_code, from_client_id, to_client_id, notes, created_by, created_by_name
  ) values (
    'TRP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 4),
    p_from_client_id, p_to_client_id, btrim(p_notes), auth.uid(), v_name
  )
  returning id into v_op;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;

    select * into v_lot from public.lots
    where id = nullif(v_item->>'lot_id', '')::uuid
    for update;

    if not found then
      raise exception 'Uno de los lotes no existe.';
    end if;

    if v_lot.client_id <> p_from_client_id then
      raise exception 'El lote % no es de la empresa que vende.', v_lot.lot_code;
    end if;

    if v_lot.status <> 'activo' then
      raise exception 'El lote % no está activo (está %).', v_lot.lot_code, v_lot.status;
    end if;

    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, v_lot.current_quantity);

    if v_qty <= 0 then
      raise exception 'La cantidad del lote % debe ser mayor a cero.', v_lot.lot_code;
    end if;

    if v_qty > v_lot.current_quantity then
      raise exception 'El lote % no tiene tanto stock (hay %).',
        v_lot.lot_code, trim(to_char(v_lot.current_quantity, 'FM999999990.99'));
    end if;

    if exists (select 1 from public.lot_transfers t
               left join public.transfer_operations o on o.id = t.operation_id
               where t.lot_id = v_lot.id and coalesce(o.status, t.status) = 'pendiente') then
      raise exception 'El lote % ya está en otro traspaso esperando aprobación.', v_lot.lot_code;
    end if;

    insert into public.lot_transfers (
      operation_id, lot_id, from_client_id, to_client_id, lot_code, product,
      quantity, notes, created_by, created_by_name
    ) values (
      v_op, v_lot.id, p_from_client_id, p_to_client_id, v_lot.lot_code, v_lot.product,
      v_qty, btrim(p_notes), auth.uid(), v_name
    );

    -- Se congela el lote COMPLETO aunque el traspaso sea parcial: si se
    -- dejara operar el sobrante, podrían despacharlo y al aprobar ya no
    -- habría stock suficiente para cumplir.
    update public.lots set status = 'retenido', updated_at = now() where id = v_lot.id;
  end loop;

  return jsonb_build_object('operation_id', v_op, 'items', v_count);
end;
$$;

grant execute on function public.request_transfer_operation(uuid, uuid, text, jsonb) to authenticated;

-- ── 6) Aprobar la operación completa (SOLO admin) ───────────
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
  v_new_lot uuid;
  v_code    text;
  v_resto   numeric(12, 2);
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
      v_new_lot, 'traspaso', v_it.quantity, 0, v_it.quantity,
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

-- ── 7) Rechazar la operación (SOLO admin) ───────────────────
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

  -- Se descongelan los lotes
  update public.lots set status = 'activo', updated_at = now()
  where id in (select lot_id from public.lot_transfers where operation_id = v_op.id)
    and status = 'retenido';

  return jsonb_build_object('operation_id', v_op.id, 'status', 'rechazado');
end;
$$;

grant execute on function public.reject_transfer_operation(uuid, text) to authenticated;

-- ── 8) Seguridad ────────────────────────────────────────────
alter table public.transfer_operations enable row level security;

drop policy if exists transfer_ops_staff_select on public.transfer_operations;
create policy transfer_ops_staff_select on public.transfer_operations
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role::text in ('administrador', 'operador')));

-- El VENDEDOR ve su traspaso desde que se pide (por eso ve el cartel).
-- El COMPRADOR recién cuando está aprobado y la mercadería ya es suya.
drop policy if exists transfer_ops_client_select on public.transfer_operations;
create policy transfer_ops_client_select on public.transfer_operations
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role::text = 'cliente'
                   and (p.client_id = transfer_operations.from_client_id
                        or (p.client_id = transfer_operations.to_client_id
                            and transfer_operations.status = 'aprobado'))));

revoke insert, update, delete on public.transfer_operations from authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select o.operation_code, o.status, f.name as vende, t.name as recibe,
--        (select count(*) from public.lot_transfers i where i.operation_id = o.id) as lotes
--   from public.transfer_operations o
--   join public.clients f on f.id = o.from_client_id
--   join public.clients t on t.id = o.to_client_id
--  order by o.created_at desc;
