-- ============================================================
-- TRASPASO ENTRE CLIENTES (cambio de dueño)
--
-- Caso real: el cliente A le vende mercadería al cliente B. La mercadería
-- NO se mueve del depósito: cambia de dueño y nada más.
--
-- Reglas acordadas con Harold (2026-07-31):
--   · Lo registra el operador (o el admin) con una nota. NO exige documento.
--   · SIEMPRE requiere aprobación del ADMINISTRADOR.
--   · Mientras espera aprobación el lote queda CONGELADO: no se puede
--     despachar, ni reparar, ni operar de ninguna forma.
--   · El VENDEDOR sigue viendo su lote, congelado y con cartel "En traspaso"
--     (hasta la aprobación la mercadería sigue siendo suya).
--   · El COMPRADOR no lo ve hasta que el admin apruebe.
--
-- Al aprobar se registra como SALIDA del vendedor + INGRESO al comprador,
-- así el kardex de cada uno cuadra solo y el cobro de almacenaje se corrige
-- desde ese día. Si solo se cambiara el nombre del dueño, el vendedor
-- perdería el lote de su historial como si nunca hubiera existido.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

create table if not exists public.lot_transfers (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  lot_id         uuid not null references public.lots(id) on delete cascade,
  from_client_id uuid not null references public.clients(id),
  to_client_id   uuid not null references public.clients(id),
  lot_code       text,
  product        text,
  quantity       numeric(12, 2) not null,
  notes          text not null,
  status         text not null default 'pendiente'
                 check (status in ('pendiente', 'aprobado', 'rechazado')),
  created_by     uuid references auth.users(id) on delete set null,
  created_by_name text,
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at    timestamptz,
  review_notes   text,
  new_lot_id     uuid references public.lots(id) on delete set null
);

create index if not exists lot_transfers_status_idx
  on public.lot_transfers (status, created_at desc);

-- Un lote no puede tener dos traspasos pendientes a la vez
create unique index if not exists lot_transfers_one_pending_idx
  on public.lot_transfers (lot_id) where status = 'pendiente';

-- ── EL CANDADO ──────────────────────────────────────────────
-- Trigger sobre `movements`: mientras el lote tenga un traspaso PENDIENTE no
-- entra ningún movimiento, venga de donde venga (app, escáner, cola offline,
-- despacho, reparación). Un solo control cubre todos los caminos: es mucho
-- más difícil de saltarse que poner el chequeo en cada pantalla.
create or replace function public.block_movements_on_pending_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.lot_transfers t
    where t.lot_id = new.lot_id and t.status = 'pendiente'
  ) then
    raise exception 'Este lote está en traspaso y espera la aprobación del administrador. No se puede operar hasta que se apruebe o se rechace.';
  end if;
  return new;
end;
$$;

drop trigger if exists movements_block_on_pending_transfer on public.movements;
create trigger movements_block_on_pending_transfer
  before insert on public.movements
  for each row execute function public.block_movements_on_pending_transfer();

-- ── 1) Pedir el traspaso (operador o admin) ─────────────────
create or replace function public.request_lot_transfer(
  p_lot_id       uuid,
  p_to_client_id uuid,
  p_notes        text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_name text;
  v_lot  public.lots%rowtype;
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
    v_lot.current_quantity, btrim(p_notes), auth.uid(), v_name
  )
  returning id into v_id;

  -- Congela el lote. El vendedor lo sigue viendo (sigue siendo suyo), pero
  -- retenido + el traspaso pendiente lo dejan intocable.
  update public.lots
  set status = 'retenido', updated_at = now()
  where id = v_lot.id;

  return jsonb_build_object('id', v_id, 'lot_id', v_lot.id, 'status', 'pendiente');
end;
$$;

grant execute on function public.request_lot_transfer(uuid, uuid, text) to authenticated;

-- ── 2) Aprobar el traspaso (SOLO admin) ─────────────────────
-- Salida del vendedor + ingreso al comprador, en un solo acto.
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

  v_qty := coalesce(v_lot.current_quantity, 0);
  if v_qty <= 0 then
    raise exception 'El lote se quedó sin stock. Rechazá el traspaso.';
  end if;

  select name into v_from from public.clients where id = v_t.from_client_id;
  select name into v_to   from public.clients where id = v_t.to_client_id;

  -- Se marca aprobado ANTES de mover stock: así el candado de arriba deja
  -- pasar los dos movimientos de este mismo traspaso.
  update public.lot_transfers
  set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name,
      reviewed_at = now()
  where id = v_t.id;

  -- Lote nuevo para el comprador: misma mercadería, mismo lote real, mismo
  -- vencimiento y misma ubicación. Solo cambia el dueño.
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
    v_lot.id, 'salida', v_qty, v_qty, 0,
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

  -- El lote del vendedor queda en cero y cerrado (no desaparece: su
  -- historial completo sigue disponible).
  update public.lots
  set current_quantity = 0, status = 'cerrado', updated_at = now()
  where id = v_lot.id;

  update public.lot_transfers set new_lot_id = v_new_lot where id = v_t.id;

  return jsonb_build_object(
    'transfer_id', v_t.id,
    'new_lot_id',  v_new_lot,
    'quantity',    v_qty,
    'from',        v_from,
    'to',          v_to
  );
end;
$$;

grant execute on function public.approve_lot_transfer(uuid) to authenticated;

-- ── 3) Rechazar el traspaso (SOLO admin) ────────────────────
create or replace function public.reject_lot_transfer(
  p_transfer_id uuid,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
  v_name text;
  v_t    public.lot_transfers%rowtype;
begin
  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede rechazar un traspaso.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribí por qué se rechaza el traspaso.';
  end if;

  select * into v_t from public.lot_transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'Traspaso no encontrado.';
  end if;
  if v_t.status <> 'pendiente' then
    raise exception 'Este traspaso ya fue %.', v_t.status;
  end if;

  update public.lot_transfers
  set status = 'rechazado', reviewed_by = auth.uid(), reviewed_by_name = v_name,
      reviewed_at = now(), review_notes = btrim(p_reason)
  where id = v_t.id;

  -- Se descongela: el lote vuelve a estar operativo para el vendedor.
  update public.lots
  set status = 'activo', updated_at = now()
  where id = v_t.lot_id and status = 'retenido';

  return jsonb_build_object('transfer_id', v_t.id, 'status', 'rechazado');
end;
$$;

grant execute on function public.reject_lot_transfer(uuid, text) to authenticated;

-- ── Seguridad de la tabla ───────────────────────────────────
alter table public.lot_transfers enable row level security;

-- Admin y operador ven todos los traspasos
drop policy if exists lot_transfers_staff_select on public.lot_transfers;
create policy lot_transfers_staff_select on public.lot_transfers
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role::text in ('administrador', 'operador')));

-- El VENDEDOR ve el traspaso de su lote (por eso ve el cartel "En traspaso").
-- El COMPRADOR NO lo ve mientras está pendiente: recién cuando se aprueba,
-- y el lote ya es suyo.
drop policy if exists lot_transfers_client_select on public.lot_transfers;
create policy lot_transfers_client_select on public.lot_transfers
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role::text = 'cliente'
                   and (p.client_id = lot_transfers.from_client_id
                        or (p.client_id = lot_transfers.to_client_id
                            and lot_transfers.status = 'aprobado'))));

-- Nadie escribe directo: solo por las funciones (que validan el rol)
revoke insert, update, delete on public.lot_transfers from authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select lot_code, product, quantity, status, notes, created_by_name, created_at
--   from public.lot_transfers order by created_at desc;
