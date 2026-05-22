create table if not exists public.operational_issue_reports (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots(id),
  issue_type text not null check (issue_type in ('qr_danado', 'producto_danado', 'ubicacion_no_coincide', 'falta_producto', 'otro')),
  notes text,
  status text not null default 'pendiente' check (status in ('pendiente', 'resuelto')),
  reported_by uuid not null references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.movement_correction_requests (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null references public.movements(id),
  correction_type text not null default 'cantidad' check (correction_type in ('cantidad', 'ficha', 'operacion')),
  requested_quantity numeric(12, 2) check (requested_quantity >= 0),
  lot_patch jsonb not null default '{}'::jsonb,
  reason text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.movement_correction_requests
add column if not exists correction_type text not null default 'cantidad',
add column if not exists lot_patch jsonb not null default '{}'::jsonb;

alter table public.movement_correction_requests
alter column requested_quantity drop not null;

alter table public.movement_correction_requests
drop constraint if exists movement_correction_requests_correction_type_check;

alter table public.movement_correction_requests
add constraint movement_correction_requests_correction_type_check
check (correction_type in ('cantidad', 'ficha', 'operacion'));

create index if not exists operational_issue_reports_status_idx on public.operational_issue_reports(status, created_at desc);
create index if not exists movement_correction_requests_status_idx on public.movement_correction_requests(status, created_at desc);

create or replace function public.apply_operation_note_patch(
  p_notes text,
  p_patch jsonb
)
returns text
language plpgsql
immutable
as $$
declare
  v_part text;
  v_parts text[] := array[]::text[];
begin
  foreach v_part in array regexp_split_to_array(coalesce(p_notes, ''), '\s*\|\s*')
  loop
    if coalesce(trim(v_part), '') = '' then
      continue;
    end if;
    if p_patch ? 'vehicle_plate' and trim(v_part) like 'Placa:%' then
      continue;
    end if;
    if p_patch ? 'receiver_name' and trim(v_part) like 'Recibe:%' then
      continue;
    end if;
    if p_patch ? 'receiver_document' and trim(v_part) like 'Documento:%' then
      continue;
    end if;
    v_parts := array_append(v_parts, trim(v_part));
  end loop;

  if p_patch ? 'receiver_document' and coalesce(trim(p_patch->>'receiver_document'), '') <> '' then
    v_parts := array_prepend(concat('Documento: ', trim(p_patch->>'receiver_document')), v_parts);
  end if;
  if p_patch ? 'receiver_name' and coalesce(trim(p_patch->>'receiver_name'), '') <> '' then
    v_parts := array_prepend(concat('Recibe: ', trim(p_patch->>'receiver_name')), v_parts);
  end if;
  if p_patch ? 'vehicle_plate' and coalesce(trim(p_patch->>'vehicle_plate'), '') <> '' then
    v_parts := array_prepend(concat('Placa: ', trim(p_patch->>'vehicle_plate')), v_parts);
  end if;

  return nullif(array_to_string(v_parts, ' | '), '');
end;
$$;

alter table public.operational_issue_reports enable row level security;
alter table public.movement_correction_requests enable row level security;

drop policy if exists "Operaciones crean reportes operativos" on public.operational_issue_reports;
create policy "Operaciones crean reportes operativos"
on public.operational_issue_reports for insert
to authenticated
with check (
  reported_by = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('administrador', 'operador')
  )
);

drop policy if exists "Operaciones leen sus reportes y admin todos" on public.operational_issue_reports;
create policy "Operaciones leen sus reportes y admin todos"
on public.operational_issue_reports for select
to authenticated
using (
  reported_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
);

drop policy if exists "Admin resuelve reportes operativos" on public.operational_issue_reports;
create policy "Admin resuelve reportes operativos"
on public.operational_issue_reports for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
);

drop policy if exists "Operaciones leen sus correcciones y admin todas" on public.movement_correction_requests;
create policy "Operaciones leen sus correcciones y admin todas"
on public.movement_correction_requests for select
to authenticated
using (
  requested_by = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
);

drop function if exists public.request_movement_correction(uuid, numeric, text, uuid);
drop function if exists public.request_movement_correction(uuid, numeric, text, jsonb, text, uuid);

create or replace function public.request_movement_correction(
  p_movement_id uuid,
  p_requested_quantity numeric,
  p_correction_type text,
  p_lot_patch jsonb,
  p_reason text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_movement public.movements%rowtype;
  v_request_id uuid;
  v_role text;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario no coincide con la sesion activa.';
  end if;

  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para solicitar correcciones.';
  end if;

  select * into v_movement
  from public.movements
  where id = p_movement_id
  for update;

  if not found or v_movement.type not in ('entrada', 'salida') or v_movement.approval_status <> 'aprobado' then
    raise exception 'Solo se corrigen entradas o salidas aplicadas.';
  end if;

  if v_role = 'operador' and v_movement.user_id <> auth.uid() then
    raise exception 'Solo puedes corregir movimientos hechos por tu usuario.';
  end if;

  if p_correction_type not in ('cantidad', 'ficha', 'operacion') or coalesce(trim(p_reason), '') = '' then
    raise exception 'La correccion requiere tipo y motivo.';
  end if;

  if p_correction_type = 'cantidad' and (p_requested_quantity is null or p_requested_quantity < 0) then
    raise exception 'La correccion de cantidad requiere cantidad correcta.';
  end if;

  if p_correction_type = 'cantidad' and v_movement.type = 'salida' and p_requested_quantity > v_movement.previous_quantity then
    raise exception 'No hay inventario suficiente para esa correccion.';
  end if;

  if p_correction_type = 'ficha' and coalesce(p_lot_patch, '{}'::jsonb) = '{}'::jsonb then
    raise exception 'La correccion de ficha requiere cambios.';
  end if;

  if p_correction_type = 'operacion' and (
    jsonb_typeof(p_lot_patch->'movement_ids') <> 'array'
    or jsonb_array_length(p_lot_patch->'movement_ids') = 0
  ) then
    raise exception 'La correccion de operacion requiere movimientos.';
  end if;

  if p_correction_type = 'operacion' and exists (
    select 1
    from jsonb_array_elements_text(p_lot_patch->'movement_ids') movement_id(value)
    left join public.movements m on m.id = movement_id.value::uuid
    where m.id is null
      or m.type not in ('entrada', 'salida')
      or m.approval_status <> 'aprobado'
      or (v_role = 'operador' and m.user_id <> auth.uid())
  ) then
    raise exception 'La operacion contiene movimientos que no puedes corregir.';
  end if;

  insert into public.movement_correction_requests (movement_id, correction_type, requested_quantity, lot_patch, reason, requested_by)
  values (p_movement_id, p_correction_type, p_requested_quantity, coalesce(p_lot_patch, '{}'::jsonb), trim(p_reason), p_user_id)
  returning id into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.approve_movement_correction(
  p_request_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_request public.movement_correction_requests%rowtype;
  v_movement public.movements%rowtype;
  v_lot public.lots%rowtype;
  v_delta numeric(12, 2);
  v_audit_quantity numeric(12, 2);
  v_new_quantity numeric(12, 2);
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario no coincide con la sesion activa.';
  end if;

  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role <> 'administrador' then
    raise exception 'Solo administracion aprueba correcciones.';
  end if;

  select * into v_request
  from public.movement_correction_requests
  where id = p_request_id
  for update;

  if not found or v_request.status <> 'pendiente' then
    raise exception 'La correccion ya fue revisada.';
  end if;

  select * into v_movement from public.movements where id = v_request.movement_id for update;
  select * into v_lot from public.lots where id = v_movement.lot_id for update;

  if v_request.correction_type = 'cantidad' then
    if v_movement.type = 'salida' and v_request.requested_quantity > v_movement.previous_quantity then
      raise exception 'No hay inventario suficiente para esa correccion.';
    end if;

    v_delta := case
      when v_movement.type = 'entrada' then v_request.requested_quantity - v_movement.quantity
      when v_movement.type = 'salida' then v_movement.quantity - v_request.requested_quantity
      else 0
    end;
    v_new_quantity := v_lot.current_quantity + v_delta;

    if v_new_quantity < 0 then
      raise exception 'La correccion dejaria el stock negativo.';
    end if;

    v_audit_quantity := abs(v_delta);
    update public.lots set current_quantity = v_new_quantity where id = v_lot.id;
  elsif v_request.correction_type = 'ficha' then
    v_new_quantity := v_lot.current_quantity;
    v_audit_quantity := 0;
    update public.lots
    set
      client_id = case when v_request.lot_patch ? 'client_id' then (v_request.lot_patch->>'client_id')::uuid else client_id end,
      lot_code = case when v_request.lot_patch ? 'lot_code' and coalesce(trim(v_request.lot_patch->>'lot_code'), '') <> '' then trim(v_request.lot_patch->>'lot_code') else lot_code end,
      product = case when v_request.lot_patch ? 'product' and coalesce(trim(v_request.lot_patch->>'product'), '') <> '' then trim(v_request.lot_patch->>'product') else product end,
      location = case when v_request.lot_patch ? 'location' and coalesce(trim(v_request.lot_patch->>'location'), '') <> '' then trim(v_request.lot_patch->>'location') else location end,
      package_size = case when v_request.lot_patch ? 'package_size' and nullif(trim(v_request.lot_patch->>'package_size'), '') is not null then (v_request.lot_patch->>'package_size')::numeric else package_size end,
      package_unit = case when v_request.lot_patch ? 'package_unit' and coalesce(trim(v_request.lot_patch->>'package_unit'), '') <> '' then trim(v_request.lot_patch->>'package_unit') else package_unit end,
      expiry_date = case when v_request.lot_patch ? 'expiry_date' and nullif(trim(v_request.lot_patch->>'expiry_date'), '') is not null then (v_request.lot_patch->>'expiry_date')::date else expiry_date end
    where id = v_lot.id;
  else
    v_new_quantity := v_lot.current_quantity;
    v_audit_quantity := 0;

    if v_request.lot_patch ? 'client_id' then
      update public.lots
      set client_id = (v_request.lot_patch->>'client_id')::uuid
      where id in (
        select distinct m.lot_id
        from public.movements m
        join jsonb_array_elements_text(v_request.lot_patch->'movement_ids') movement_id(value)
          on m.id = movement_id.value::uuid
      );
    end if;

    if v_request.lot_patch ? 'vehicle_plate'
      or v_request.lot_patch ? 'receiver_name'
      or v_request.lot_patch ? 'receiver_document' then
      update public.movements m
      set
        to_location = case
          when v_request.lot_patch ? 'vehicle_plate' then nullif(trim(v_request.lot_patch->>'vehicle_plate'), '')
          else m.to_location
        end,
        notes = public.apply_operation_note_patch(m.notes, v_request.lot_patch)
      from jsonb_array_elements_text(v_request.lot_patch->'movement_ids') movement_id(value)
      where m.id = movement_id.value::uuid;
    end if;
  end if;

  insert into public.movements (
    lot_id, type, quantity, previous_quantity, new_quantity, from_location, to_location, notes, user_id, approval_status, approved_by, approved_at
  )
  values (
    v_lot.id,
    'ajuste',
    v_audit_quantity,
    v_lot.current_quantity,
    v_new_quantity,
    v_lot.location,
    v_lot.location,
    case
      when v_request.correction_type = 'ficha'
        then concat('Correccion de ficha aprobada para el lote ', v_lot.lot_code, '. Cambios: ', v_request.lot_patch::text, '. Motivo: ', v_request.reason)
      when v_request.correction_type = 'operacion'
        then concat('Correccion de operacion aprobada. Cambios: ', v_request.lot_patch::text, '. Motivo: ', v_request.reason)
      else concat('Correccion aprobada del movimiento ', v_movement.id, '. Cantidad original: ', v_movement.quantity, '. Cantidad correcta: ', v_request.requested_quantity, '. Motivo: ', v_request.reason)
    end,
    p_user_id,
    'aprobado',
    p_user_id,
    now()
  );

  update public.movement_correction_requests
  set status = 'aprobado', reviewed_by = p_user_id, reviewed_at = now()
  where id = p_request_id;
end;
$$;

create or replace function public.reject_movement_correction(
  p_request_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario no coincide con la sesion activa.';
  end if;

  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role <> 'administrador' then
    raise exception 'Solo administracion rechaza correcciones.';
  end if;

  update public.movement_correction_requests
  set status = 'rechazado', reviewed_by = p_user_id, reviewed_at = now()
  where id = p_request_id and status = 'pendiente';
end;
$$;
