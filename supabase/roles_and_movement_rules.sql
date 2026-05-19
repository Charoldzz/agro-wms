alter type public.user_role add value if not exists 'oficina';

alter table public.lots
add column if not exists expiry_date date;

insert into storage.buckets (id, name, public)
values ('lot-photos', 'lot-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Usuarios autenticados leen fotos de lotes" on storage.objects;
create policy "Usuarios autenticados leen fotos de lotes"
on storage.objects for select
to authenticated
using (bucket_id = 'lot-photos');

drop policy if exists "Usuarios autenticados suben fotos de lotes" on storage.objects;
create policy "Usuarios autenticados suben fotos de lotes"
on storage.objects for insert
to authenticated
with check (bucket_id = 'lot-photos');

create or replace function public.prevent_movement_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los movimientos no se pueden borrar. Registra un ajuste para corregir.';
end;
$$;

drop trigger if exists movements_prevent_delete on public.movements;
create trigger movements_prevent_delete
before delete on public.movements
for each row execute function public.prevent_movement_delete();

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
    raise exception 'El usuario del movimiento no coincide con la sesion activa.';
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

  if p_type = 'salida' and v_lot.status in ('retenido', 'cerrado') then
    raise exception 'No se puede registrar salida porque el lote esta retenido o cerrado.';
  end if;

  if p_type = 'salida' and v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
    raise exception 'No se puede registrar salida porque el lote esta vencido.';
  end if;

  if p_type = 'entrada' then
    v_new_quantity := v_lot.current_quantity + p_quantity;
  elsif p_type = 'salida' then
    if p_quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente.';
    end if;
    v_new_quantity := v_lot.current_quantity - p_quantity;
  elsif p_type = 'ajuste' then
    if coalesce(trim(p_notes), '') = '' then
      raise exception 'Los ajustes requieren observacion.';
    end if;
    v_new_quantity := p_quantity;
  elsif p_type = 'traslado' then
    if coalesce(trim(p_to_location), '') = '' then
      raise exception 'El traslado requiere nueva ubicacion.';
    end if;
    v_new_quantity := v_lot.current_quantity;
  else
    raise exception 'Tipo de movimiento invalido.';
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

drop function if exists public.create_lot_entry(text, uuid, text, numeric, numeric, text, text, date, date, text, uuid);

create or replace function public.create_lot_entry(
  p_lot_code text,
  p_client_id uuid,
  p_product text,
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

  if v_role not in ('administrador', 'oficina', 'operador') then
    raise exception 'No tienes permiso para registrar ingresos.';
  end if;

  if coalesce(trim(p_lot_code), '') = '' then
    raise exception 'El lote es obligatorio.';
  end if;

  if coalesce(trim(p_product), '') = '' then
    raise exception 'El producto es obligatorio.';
  end if;

  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  if coalesce(trim(p_location), '') = '' then
    raise exception 'La ubicacion es obligatoria.';
  end if;

  insert into public.lots (
    lot_code,
    client_id,
    product,
    current_quantity,
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
    p_quantity,
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
    p_quantity,
    0,
    p_quantity,
    null,
    trim(p_location),
    coalesce(p_notes, 'Ingreso inicial de lote'),
    p_user_id
  );

  return v_lot_id;
end;
$$;
