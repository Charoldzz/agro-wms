-- ============================================================
-- FRACCIONAMIENTO (cambio de presentación)
--
-- Caso real: el cliente pide fraccionar. Un tambor de 200 lt se pasa a
-- bidones de 20 lt, o una caja de 25 kg a bolsas de 5 kg. La mercadería NO
-- sale del depósito y NO cambia de dueño: cambia el envase.
--
-- Reglas acordadas con Harold:
--   · El total tiene que CUADRAR. Si falta producto, se declara la MERMA
--     aparte, con motivo obligatorio — no se "evapora" nada sin justificar.
--   · Lo registra el operador y lo aprueba el admin; si lo hace el admin, se
--     aplica al instante (misma convención que reparaciones y traspasos).
--   · Mientras espera aprobación, el lote queda congelado.
--
-- Es un movimiento INTERNO con tipo propio, igual que el traspaso: no es
-- ingreso ni salida, porque nada cruzó la puerta del depósito.
--
-- Correr DESPUÉS de traspaso_admin_directo.sql. Idempotente.
-- ============================================================

-- ── 1) Tipo de movimiento propio ────────────────────────────
-- Si da "unsafe use of new value", corré SOLO esta línea y después el resto.
alter type movement_type add value if not exists 'fraccionamiento';

-- ── 2) El mismo lote puede estar en dos PRESENTACIONES ──────
-- Al fraccionar, el cliente queda con el lote 25RFS0136 como "X 20 LTS" y
-- también como "X 5 LTS": mismo lote del fabricante, distinto envase. La
-- unicidad pasa a incluir el producto.
drop index if exists public.lots_client_lot_code_key;

create unique index if not exists lots_client_product_lot_key
  on public.lots (client_id, product, lot_code);

-- El traspaso junta lotes solo si son EXACTAMENTE el mismo producto y lote
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
  if not found then raise exception 'Traspaso no encontrado.'; end if;
  if v_op.status <> 'pendiente' then raise exception 'Este traspaso ya fue %.', v_op.status; end if;

  select name into v_from from public.clients where id = v_op.from_client_id;
  select name into v_to   from public.clients where id = v_op.to_client_id;

  update public.transfer_operations
  set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now()
  where id = v_op.id;

  for v_it in select * from public.lot_transfers where operation_id = v_op.id
  loop
    v_count := v_count + 1;

    select * into v_lot from public.lots where id = v_it.lot_id for update;
    if not found then raise exception 'Un lote del traspaso ya no existe.'; end if;
    if v_it.quantity > coalesce(v_lot.current_quantity, 0) then
      raise exception 'El lote % ya no tiene stock suficiente. Rechazá el traspaso.', v_lot.lot_code;
    end if;

    v_resto := v_lot.current_quantity - v_it.quantity;

    v_code := public.resolve_client_product_code(
      v_op.to_client_id, v_lot.product, v_lot.package_size, v_lot.package_unit
    );

    select * into v_dest
    from public.lots
    where client_id = v_op.to_client_id
      and lot_code = v_lot.lot_code
      and product = v_lot.product
    for update;

    if found then
      v_prev := coalesce(v_dest.current_quantity, 0);
      update public.lots
      set current_quantity = v_prev + v_it.quantity,
          status = 'activo'::lot_status, updated_at = now()
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

    insert into public.movements (lot_id, type, quantity, previous_quantity, new_quantity,
      from_location, to_location, notes, user_id)
    values (v_lot.id, 'traspaso', v_it.quantity, v_lot.current_quantity, v_resto,
      v_lot.location, v_lot.location,
      concat('Traspaso a ', coalesce(v_to, 'otra empresa'), ' | ', v_op.notes), auth.uid());

    insert into public.movements (lot_id, type, quantity, previous_quantity, new_quantity,
      from_location, to_location, notes, user_id)
    values (v_new_lot, 'traspaso', v_it.quantity, v_prev, v_prev + v_it.quantity,
      v_lot.location, v_lot.location,
      concat('Traspaso desde ', coalesce(v_from, 'otra empresa'), ' | ', v_op.notes), auth.uid());

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

-- ── 3) El fraccionamiento ───────────────────────────────────
create table if not exists public.lot_splits (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  operation_code   text,
  client_id        uuid not null references public.clients(id),
  source_lot_id    uuid not null references public.lots(id) on delete cascade,
  lot_code         text,
  source_product   text not null,
  dest_product     text not null,
  dest_package_size numeric(12, 2),
  dest_package_unit text,
  quantity_out     numeric(12, 2) not null,   -- lo que sale del lote origen
  quantity_in      numeric(12, 2) not null,   -- lo que realmente queda fraccionado
  merma            numeric(12, 2) not null default 0,
  merma_reason     text,
  notes            text,
  status           text not null default 'pendiente'
                   check (status in ('pendiente', 'aprobado', 'rechazado')),
  created_by       uuid references auth.users(id) on delete set null,
  created_by_name  text,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  review_notes     text,
  dest_lot_id      uuid references public.lots(id) on delete set null
);

create index if not exists lot_splits_status_idx on public.lot_splits (status, created_at desc);

create unique index if not exists lot_splits_one_pending_idx
  on public.lot_splits (source_lot_id) where status = 'pendiente';

-- El candado también contempla los fraccionamientos pendientes
create or replace function public.block_movements_on_pending_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.lot_transfers t
    left join public.transfer_operations o on o.id = t.operation_id
    where t.lot_id = new.lot_id and coalesce(o.status, t.status) = 'pendiente'
  ) then
    raise exception 'Este lote está en un traspaso y espera la aprobación del administrador. No se puede operar hasta que se apruebe o se rechace.';
  end if;

  if exists (
    select 1 from public.lot_splits s
    where s.source_lot_id = new.lot_id and s.status = 'pendiente'
  ) then
    raise exception 'Este lote está en un fraccionamiento y espera la aprobación del administrador. No se puede operar hasta que se apruebe o se rechace.';
  end if;

  return new;
end;
$$;

-- ── 4) Aplicar el fraccionamiento ───────────────────────────
create or replace function public.apply_lot_split(p_split_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_s      public.lot_splits%rowtype;
  v_lot    public.lots%rowtype;
  v_dest   public.lots%rowtype;
  v_new    uuid;
  v_code   text;
  v_resto  numeric(12, 2);
  v_prev   numeric(12, 2);
  v_nota   text;
begin
  select * into v_s from public.lot_splits where id = p_split_id for update;
  if not found then raise exception 'Fraccionamiento no encontrado.'; end if;

  select * into v_lot from public.lots where id = v_s.source_lot_id for update;
  if not found then raise exception 'El lote ya no existe.'; end if;
  if v_s.quantity_out > coalesce(v_lot.current_quantity, 0) then
    raise exception 'El lote ya no tiene stock suficiente (quedan %).',
      trim(to_char(coalesce(v_lot.current_quantity, 0), 'FM999999990.99'));
  end if;

  v_resto := v_lot.current_quantity - v_s.quantity_out;
  v_nota := concat('Fraccionamiento: ', v_s.source_product, ' -> ', v_s.dest_product,
                   case when v_s.merma > 0
                        then ' | Merma: ' || trim(to_char(v_s.merma, 'FM999999990.99')) || ' ' ||
                             coalesce(v_lot.package_unit, '') || ' (' || coalesce(v_s.merma_reason, '') || ')'
                        else '' end,
                   case when coalesce(btrim(v_s.notes), '') <> '' then ' | ' || v_s.notes else '' end);

  v_code := public.resolve_client_product_code(
    v_s.client_id, v_s.dest_product, v_s.dest_package_size, v_s.dest_package_unit
  );

  -- ¿Ya tiene ese mismo lote en la presentación destino? Se suma.
  select * into v_dest
  from public.lots
  where client_id = v_s.client_id
    and lot_code = v_lot.lot_code
    and product = v_s.dest_product
  for update;

  if found then
    v_prev := coalesce(v_dest.current_quantity, 0);
    update public.lots
    set current_quantity = v_prev + v_s.quantity_in,
        status = 'activo'::lot_status, updated_at = now()
    where id = v_dest.id;
    v_new := v_dest.id;
  else
    v_prev := 0;
    insert into public.lots (
      lot_code, client_id, product, current_quantity,
      package_size, package_unit, location, entry_date, expiry_date,
      status, low_stock_threshold, inventory_source, solucion_product_code, solucion_warehouse_code
    ) values (
      v_lot.lot_code, v_s.client_id, v_s.dest_product, v_s.quantity_in,
      v_s.dest_package_size, v_s.dest_package_unit, v_lot.location, current_date, v_lot.expiry_date,
      'activo'::lot_status, v_lot.low_stock_threshold, v_lot.inventory_source, v_code,
      v_lot.solucion_warehouse_code
    )
    returning id into v_new;
  end if;

  -- Sale de la presentación original
  insert into public.movements (lot_id, type, quantity, previous_quantity, new_quantity,
    from_location, to_location, notes, user_id)
  values (v_lot.id, 'fraccionamiento', v_s.quantity_out, v_lot.current_quantity, v_resto,
    v_lot.location, v_lot.location, v_nota, coalesce(v_s.reviewed_by, v_s.created_by));

  -- Entra en la presentación nueva
  insert into public.movements (lot_id, type, quantity, previous_quantity, new_quantity,
    from_location, to_location, notes, user_id)
  values (v_new, 'fraccionamiento', v_s.quantity_in, v_prev, v_prev + v_s.quantity_in,
    v_lot.location, v_lot.location, v_nota, coalesce(v_s.reviewed_by, v_s.created_by));

  update public.lots
  set current_quantity = v_resto,
      status = (case when v_resto <= 0 then 'cerrado' else 'activo' end)::lot_status,
      updated_at = now()
  where id = v_lot.id;

  update public.lot_splits set dest_lot_id = v_new where id = v_s.id;

  return jsonb_build_object('split_id', v_s.id, 'dest_lot_id', v_new);
end;
$$;

-- ── 5) Pedir el fraccionamiento ─────────────────────────────
create or replace function public.request_lot_split(
  p_lot_id       uuid,
  p_dest_product text,
  p_quantity_out numeric,
  p_quantity_in  numeric,
  p_merma_reason text,
  p_notes        text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role  text;
  v_name  text;
  v_lot   public.lots%rowtype;
  v_cat   public.product_catalog%rowtype;
  v_merma numeric(12, 2);
  v_id    uuid;
  v_code  text;
  v_auto  boolean := false;
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión.'; end if;

  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('administrador', 'operador') then
    raise exception 'No tenés permiso para registrar un fraccionamiento.';
  end if;

  select * into v_lot from public.lots where id = p_lot_id for update;
  if not found then raise exception 'Lote no encontrado.'; end if;
  if v_lot.status <> 'activo'::lot_status then
    raise exception 'El lote no está activo (está %).', v_lot.status;
  end if;

  if coalesce(p_quantity_out, 0) <= 0 then
    raise exception 'Indicá cuánto se fracciona.';
  end if;
  if p_quantity_out > coalesce(v_lot.current_quantity, 0) then
    raise exception 'El lote tiene %.', trim(to_char(coalesce(v_lot.current_quantity, 0), 'FM999999990.99'));
  end if;
  if coalesce(p_quantity_in, 0) <= 0 then
    raise exception 'Indicá cuánto queda fraccionado.';
  end if;
  if p_quantity_in > p_quantity_out then
    raise exception 'No puede quedar MÁS de lo que se fracciona. Sale % y estás cargando %.',
      trim(to_char(p_quantity_out, 'FM999999990.99')), trim(to_char(p_quantity_in, 'FM999999990.99'));
  end if;

  v_merma := p_quantity_out - p_quantity_in;

  -- Si falta producto hay que justificarlo: nada se pierde sin explicación
  if v_merma > 0 and coalesce(btrim(p_merma_reason), '') = '' then
    raise exception 'Faltan % en el fraccionamiento. Declará el motivo de la merma.',
      trim(to_char(v_merma, 'FM999999990.99'));
  end if;

  if coalesce(btrim(p_dest_product), '') = '' then
    raise exception 'Elegí la presentación a la que se fracciona.';
  end if;
  if upper(btrim(p_dest_product)) = upper(btrim(v_lot.product)) then
    raise exception 'La presentación de destino tiene que ser distinta a la actual.';
  end if;

  -- La presentación destino tiene que existir en el catálogo del cliente
  select * into v_cat from public.product_catalog
  where client_id = v_lot.client_id
    and upper(btrim(name)) = upper(btrim(p_dest_product))
  limit 1;

  if not found then
    raise exception 'La presentación "%" no está en el catálogo de esta empresa. Cargala primero.', p_dest_product;
  end if;

  if exists (select 1 from public.lot_splits s where s.source_lot_id = p_lot_id and s.status = 'pendiente') then
    raise exception 'Este lote ya tiene un fraccionamiento esperando aprobación.';
  end if;

  v_code := public.next_warehouse_guide('frc');

  insert into public.lot_splits (
    operation_code, client_id, source_lot_id, lot_code, source_product, dest_product,
    dest_package_size, dest_package_unit, quantity_out, quantity_in, merma, merma_reason,
    notes, created_by, created_by_name
  ) values (
    v_code, v_lot.client_id, v_lot.id, v_lot.lot_code, v_lot.product, btrim(v_cat.name),
    v_cat.package_size, v_cat.package_unit, p_quantity_out, p_quantity_in, v_merma,
    nullif(btrim(coalesce(p_merma_reason, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), v_name
  )
  returning id into v_id;

  update public.lots set status = 'retenido'::lot_status, updated_at = now() where id = v_lot.id;

  -- El admin no se aprueba a sí mismo
  if v_role = 'administrador' then
    update public.lot_splits
    set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now()
    where id = v_id;
    perform public.apply_lot_split(v_id);
    v_auto := true;
  end if;

  return jsonb_build_object('id', v_id, 'operation_code', v_code, 'merma', v_merma, 'aplicado', v_auto);
end;
$$;

grant execute on function public.request_lot_split(uuid, text, numeric, numeric, text, text) to authenticated;

-- ── 6) Aprobar / rechazar (SOLO admin) ──────────────────────
create or replace function public.approve_lot_split(p_split_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_role text; v_name text; v_s public.lot_splits%rowtype;
begin
  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();
  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede aprobar un fraccionamiento.';
  end if;

  select * into v_s from public.lot_splits where id = p_split_id for update;
  if not found then raise exception 'Fraccionamiento no encontrado.'; end if;
  if v_s.status <> 'pendiente' then raise exception 'Este fraccionamiento ya fue %.', v_s.status; end if;

  update public.lot_splits
  set status = 'aprobado', reviewed_by = auth.uid(), reviewed_by_name = v_name, reviewed_at = now()
  where id = v_s.id;

  return public.apply_lot_split(v_s.id);
end;
$$;

grant execute on function public.approve_lot_split(uuid) to authenticated;

create or replace function public.reject_lot_split(p_split_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare v_role text; v_name text; v_s public.lot_splits%rowtype;
begin
  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();
  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede rechazar un fraccionamiento.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Escribí por qué se rechaza.';
  end if;

  select * into v_s from public.lot_splits where id = p_split_id for update;
  if not found then raise exception 'Fraccionamiento no encontrado.'; end if;
  if v_s.status <> 'pendiente' then raise exception 'Este fraccionamiento ya fue %.', v_s.status; end if;

  update public.lot_splits
  set status = 'rechazado', reviewed_by = auth.uid(), reviewed_by_name = v_name,
      reviewed_at = now(), review_notes = btrim(p_reason)
  where id = v_s.id;

  update public.lots set status = 'activo'::lot_status, updated_at = now()
  where id = v_s.source_lot_id and status = 'retenido'::lot_status;

  return jsonb_build_object('split_id', v_s.id, 'status', 'rechazado');
end;
$$;

grant execute on function public.reject_lot_split(uuid, text) to authenticated;

-- ── 7) Numeración FRC-00001 ─────────────────────────────────
INSERT INTO public.warehouse_operation_counters (counter_name, next_number)
VALUES ('guide_frc', 1)
ON CONFLICT (counter_name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_warehouse_guide(p_type text DEFAULT 'sal')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_counter text; v_prefix text; v_number bigint;
BEGIN
  IF lower(p_type) = 'ing' THEN v_counter := 'guide_ing'; v_prefix := 'ING-';
  ELSIF lower(p_type) = 'trp' THEN v_counter := 'guide_trp'; v_prefix := 'TRP-';
  ELSIF lower(p_type) = 'frc' THEN v_counter := 'guide_frc'; v_prefix := 'FRC-';
  ELSE v_counter := 'guide_sal'; v_prefix := 'SAL-';
  END IF;

  UPDATE public.warehouse_operation_counters
  SET next_number = next_number + 1
  WHERE counter_name = v_counter
  RETURNING next_number - 1 INTO v_number;

  IF v_number IS NULL THEN
    INSERT INTO public.warehouse_operation_counters (counter_name, next_number)
    VALUES (v_counter, 2)
    ON CONFLICT (counter_name) DO UPDATE
      SET next_number = public.warehouse_operation_counters.next_number + 1
    RETURNING public.warehouse_operation_counters.next_number - 1 INTO v_number;
  END IF;

  RETURN v_prefix || lpad(v_number::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_warehouse_guide(text) TO authenticated;

-- ── 8) Seguridad ────────────────────────────────────────────
alter table public.lot_splits enable row level security;

drop policy if exists lot_splits_staff_select on public.lot_splits;
create policy lot_splits_staff_select on public.lot_splits
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role::text in ('administrador', 'operador')));

drop policy if exists lot_splits_client_select on public.lot_splits;
create policy lot_splits_client_select on public.lot_splits
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role::text = 'cliente'
                   and p.client_id = lot_splits.client_id));

revoke insert, update, delete on public.lot_splits from authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select operation_code, source_product, dest_product, quantity_out, quantity_in,
--        merma, merma_reason, status from public.lot_splits order by created_at desc;
