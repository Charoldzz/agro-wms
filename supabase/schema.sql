create extension if not exists "pgcrypto";

create type user_role as enum ('administrador', 'operador');
create type lot_status as enum ('activo', 'retenido', 'cerrado');
create type movement_type as enum ('entrada', 'salida', 'traslado', 'ajuste');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'operador',
  created_at timestamptz not null default now()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.lots (
  id uuid primary key default gen_random_uuid(),
  lot_code text not null unique,
  client_id uuid not null references public.clients(id),
  product text not null,
  current_quantity numeric(12, 2) not null default 0 check (current_quantity >= 0),
  entry_boxes numeric(12, 2) not null default 0 check (entry_boxes >= 0),
  package_size numeric(12, 2),
  package_unit text,
  location text not null,
  entry_date date not null default current_date,
  expiry_date date,
  status lot_status not null default 'activo',
  photo_url text,
  low_stock_threshold numeric(12, 2) not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots(id) on delete cascade,
  type movement_type not null,
  quantity numeric(12, 2) not null check (quantity >= 0),
  previous_quantity numeric(12, 2) not null,
  new_quantity numeric(12, 2) not null,
  from_location text,
  to_location text,
  notes text,
  approval_status text not null default 'aprobado',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index lots_client_id_idx on public.lots(client_id);
create index lots_location_idx on public.lots(location);
create index movements_lot_id_created_at_idx on public.movements(lot_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lots_set_updated_at
before update on public.lots
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'operador')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.register_movement(
  p_lot_id uuid,
  p_type movement_type,
  p_quantity numeric,
  p_to_location text,
  p_notes text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.lots%rowtype;
  v_new_quantity numeric(12, 2);
  v_movement_id uuid;
  v_role public.user_role;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del movimiento no coincide con la sesión activa.';
  end if;

  if p_quantity < 0 then
    raise exception 'La cantidad no puede ser negativa.';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  select * into v_lot
  from public.lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'Lote no encontrado.';
  end if;

  if p_type = 'entrada' then
    v_new_quantity := v_lot.current_quantity + p_quantity;
  elsif p_type = 'salida' then
    if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
      raise exception 'No se puede registrar salida porque el lote esta vencido.';
    end if;
    if p_quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente.';
    end if;
    v_new_quantity := v_lot.current_quantity - p_quantity;
  elsif p_type = 'ajuste' then
    if v_role = 'operador' then
      insert into public.movements (
        lot_id,
        type,
        quantity,
        previous_quantity,
        new_quantity,
        from_location,
        to_location,
        notes,
        user_id,
        approval_status
      )
      values (
        p_lot_id,
        p_type,
        p_quantity,
        v_lot.current_quantity,
        v_lot.current_quantity,
        v_lot.location,
        p_to_location,
        p_notes,
        p_user_id,
        'pendiente'
      )
      returning id into v_movement_id;

      return v_movement_id;
    end if;
    v_new_quantity := p_quantity;
  elsif p_type = 'traslado' then
    if v_role = 'operador' then
      insert into public.movements (
        lot_id,
        type,
        quantity,
        previous_quantity,
        new_quantity,
        from_location,
        to_location,
        notes,
        user_id,
        approval_status
      )
      values (
        p_lot_id,
        p_type,
        p_quantity,
        v_lot.current_quantity,
        v_lot.current_quantity,
        v_lot.location,
        p_to_location,
        p_notes,
        p_user_id,
        'pendiente'
      )
      returning id into v_movement_id;

      return v_movement_id;
    end if;
    v_new_quantity := v_lot.current_quantity;
  else
    raise exception 'Tipo de movimiento inválido.';
  end if;

  update public.lots
  set
    current_quantity = v_new_quantity,
    location = case when p_type = 'traslado' and p_to_location is not null then p_to_location else location end
  where id = p_lot_id;

  insert into public.movements (
    lot_id,
    type,
    quantity,
    previous_quantity,
    new_quantity,
    from_location,
    to_location,
    notes,
    user_id
  )
  values (
    p_lot_id,
    p_type,
    p_quantity,
    v_lot.current_quantity,
    v_new_quantity,
    v_lot.location,
    p_to_location,
    p_notes,
    p_user_id
  )
  returning id into v_movement_id;

  return v_movement_id;
end;
$$;

create or replace function public.approve_adjustment(
  p_movement_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_movement public.movements%rowtype;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario no coincide con la sesion activa.';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role <> 'administrador' then
    raise exception 'Solo un administrador puede aprobar movimientos pendientes.';
  end if;

  select * into v_movement
  from public.movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'Movimiento no encontrado.';
  end if;

  if v_movement.type not in ('ajuste', 'traslado') or v_movement.approval_status <> 'pendiente' then
    raise exception 'Este movimiento no esta pendiente de aprobacion.';
  end if;

  if v_movement.type = 'ajuste' then
    update public.lots
    set current_quantity = v_movement.quantity
    where id = v_movement.lot_id;
  elsif v_movement.type = 'traslado' then
    update public.lots
    set location = v_movement.to_location
    where id = v_movement.lot_id;
  end if;

  update public.movements
  set
    new_quantity = case when v_movement.type = 'ajuste' then v_movement.quantity else v_movement.previous_quantity end,
    approval_status = 'aprobado',
    approved_by = p_user_id,
    approved_at = now()
  where id = p_movement_id;
end;
$$;

create or replace function public.reject_adjustment(
  p_movement_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario no coincide con la sesion activa.';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role <> 'administrador' then
    raise exception 'Solo un administrador puede rechazar reparaciones.';
  end if;

  update public.movements
  set
    approval_status = 'rechazado',
    approved_by = p_user_id,
    approved_at = now()
  where id = p_movement_id
    and type in ('ajuste', 'traslado')
    and approval_status = 'pendiente';
end;
$$;

create or replace function public.create_lot_entry(
  p_lot_code text,
  p_client_id uuid,
  p_product text,
  p_box_count numeric,
  p_quantity numeric,
  p_package_size numeric,
  p_package_unit text,
  p_location text,
  p_entry_date date,
  p_expiry_date date,
  p_photo_url text,
  p_notes text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot_id uuid;
  v_role public.user_role;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del ingreso no coincide con la sesion activa.';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para registrar ingresos.';
  end if;

  if coalesce(trim(p_lot_code), '') = '' then
    raise exception 'El lote es obligatorio.';
  end if;

  if coalesce(trim(p_product), '') = '' then
    raise exception 'El producto es obligatorio.';
  end if;

  if coalesce(p_box_count, 0) <= 0 then
    raise exception 'La cantidad de cajas debe ser mayor a cero.';
  end if;

  if coalesce(p_quantity, 0) < 0 then
    raise exception 'La cantidad de envases no puede ser negativa.';
  end if;

  if coalesce(trim(p_location), '') = '' then
    raise exception 'La ubicacion es obligatoria.';
  end if;

  insert into public.lots (
    lot_code,
    client_id,
    product,
    current_quantity,
    entry_boxes,
    package_size,
    package_unit,
    location,
    entry_date,
    expiry_date,
    status,
    photo_url,
    low_stock_threshold
  )
  values (
    trim(p_lot_code),
    p_client_id,
    trim(p_product),
    greatest(coalesce(p_quantity, 0), 0),
    p_box_count,
    p_package_size,
    p_package_unit,
    trim(p_location),
    coalesce(p_entry_date, current_date),
    p_expiry_date,
    'activo',
    nullif(trim(coalesce(p_photo_url, '')), ''),
    5
  )
  returning id into v_lot_id;

  insert into public.movements (
    lot_id,
    type,
    quantity,
    previous_quantity,
    new_quantity,
    from_location,
    to_location,
    notes,
    user_id
  )
  values (
    v_lot_id,
    'entrada',
    greatest(coalesce(p_quantity, 0), 0),
    0,
    greatest(coalesce(p_quantity, 0), 0),
    null,
    trim(p_location),
    concat('Cajas ingresadas: ', p_box_count, '. ', coalesce(p_notes, 'Ingreso inicial de lote')),
    p_user_id
  );

  return v_lot_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.lots enable row level security;
alter table public.movements enable row level security;

create policy "Usuarios autenticados leen perfiles"
on public.profiles for select
to authenticated
using (true);

create policy "Usuarios autenticados leen clientes"
on public.clients for select
to authenticated
using (true);

create policy "Administradores gestionan clientes"
on public.clients for all
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'administrador'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'administrador'));

create policy "Usuarios autenticados leen lotes"
on public.lots for select
to authenticated
using (true);

create policy "Administradores crean lotes"
on public.lots for insert
to authenticated
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'administrador'));

create policy "Administradores actualizan lotes"
on public.lots for update
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'administrador'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'administrador'));

create policy "Usuarios autenticados leen movimientos"
on public.movements for select
to authenticated
using (true);
