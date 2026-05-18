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
  package_size numeric(12, 2),
  package_unit text,
  location text not null,
  entry_date date not null default current_date,
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
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del movimiento no coincide con la sesión activa.';
  end if;

  if p_quantity < 0 then
    raise exception 'La cantidad no puede ser negativa.';
  end if;

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
    if p_quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente.';
    end if;
    if v_lot.package_size is not null and v_lot.package_size > 0 and mod(p_quantity, v_lot.package_size) <> 0 then
      raise exception 'La cantidad debe ser múltiplo de la presentación del producto.';
    end if;
    v_new_quantity := v_lot.current_quantity - p_quantity;
  elsif p_type = 'ajuste' then
    v_new_quantity := p_quantity;
  elsif p_type = 'traslado' then
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
