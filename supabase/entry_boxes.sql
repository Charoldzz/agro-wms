-- Nuevo ingreso por cajas con envases opcionales.
-- Ejecutar una vez en Supabase SQL Editor antes de usar la version que envia p_box_count.

alter table public.lots
add column if not exists entry_boxes numeric(12, 2) not null default 0 check (entry_boxes >= 0);

drop function if exists public.create_lot_entry(text, uuid, text, numeric, numeric, text, text, date, date, text, text, uuid);
drop function if exists public.create_lot_entry(text, uuid, text, numeric, numeric, text, text, date, date, text, uuid);

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
  v_quantity numeric(12, 2) := greatest(coalesce(p_quantity, 0), 0);
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
    v_quantity,
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
    v_quantity,
    0,
    v_quantity,
    null,
    trim(p_location),
    concat('Cajas ingresadas: ', p_box_count, '. ', coalesce(p_notes, 'Ingreso inicial de lote')),
    p_user_id
  );

  return v_lot_id;
end;
$$;
