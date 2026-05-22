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
  requested_quantity numeric(12, 2) not null check (requested_quantity >= 0),
  reason text not null,
  status text not null default 'pendiente' check (status in ('pendiente', 'aprobado', 'rechazado')),
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists operational_issue_reports_status_idx on public.operational_issue_reports(status, created_at desc);
create index if not exists movement_correction_requests_status_idx on public.movement_correction_requests(status, created_at desc);

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

create or replace function public.request_movement_correction(
  p_movement_id uuid,
  p_requested_quantity numeric,
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

  if p_requested_quantity < 0 or coalesce(trim(p_reason), '') = '' then
    raise exception 'La correccion requiere cantidad correcta y motivo.';
  end if;

  insert into public.movement_correction_requests (movement_id, requested_quantity, reason, requested_by)
  values (p_movement_id, p_requested_quantity, trim(p_reason), p_user_id)
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

  v_delta := case
    when v_movement.type = 'entrada' then v_request.requested_quantity - v_movement.quantity
    when v_movement.type = 'salida' then v_movement.quantity - v_request.requested_quantity
    else 0
  end;
  v_new_quantity := v_lot.current_quantity + v_delta;

  if v_new_quantity < 0 then
    raise exception 'La correccion dejaria el stock negativo.';
  end if;

  update public.lots set current_quantity = v_new_quantity where id = v_lot.id;

  insert into public.movements (
    lot_id, type, quantity, previous_quantity, new_quantity, from_location, to_location, notes, user_id, approval_status, approved_by, approved_at
  )
  values (
    v_lot.id,
    'ajuste',
    v_new_quantity,
    v_lot.current_quantity,
    v_new_quantity,
    v_lot.location,
    v_lot.location,
    concat('Correccion aprobada del movimiento ', v_movement.id, '. Cantidad original: ', v_movement.quantity, '. Cantidad correcta: ', v_request.requested_quantity, '. Motivo: ', v_request.reason),
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
