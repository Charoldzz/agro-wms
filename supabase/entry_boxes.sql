-- Nuevo ingreso con cajas, envases por caja y envases sueltos.
-- Ejecutar una vez en Supabase SQL Editor antes de usar la version que calcula envases del ingreso.

alter table public.lots
add column if not exists entry_boxes numeric(12, 2) not null default 0 check (entry_boxes >= 0);

alter table public.lots
add column if not exists entry_units_per_box numeric(12, 2) not null default 0 check (entry_units_per_box >= 0);

alter table public.lots
add column if not exists entry_loose_units numeric(12, 2) not null default 0 check (entry_loose_units >= 0);

drop function if exists public.create_lot_entry(text, uuid, text, numeric, numeric, text, text, date, date, text, text, uuid);
drop function if exists public.create_lot_entry(text, uuid, text, numeric, numeric, text, text, date, date, text, uuid);
drop function if exists public.create_lot_entry(text, uuid, text, numeric, numeric, numeric, text, text, date, date, text, text, uuid);

create or replace function public.create_lot_entry(
  p_lot_code text,
  p_client_id uuid,
  p_product text,
  p_box_count numeric,
  p_units_per_box numeric,
  p_loose_units numeric,
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
  v_box_count numeric(12, 2) := greatest(coalesce(p_box_count, 0), 0);
  v_units_per_box numeric(12, 2) := greatest(coalesce(p_units_per_box, 0), 0);
  v_loose_units numeric(12, 2) := greatest(coalesce(p_loose_units, 0), 0);
  v_quantity numeric(12, 2);
begin
  v_quantity := v_box_count * v_units_per_box + v_loose_units;

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

  if coalesce(p_box_count, 0) < 0 then
    raise exception 'La cantidad de cajas no puede ser negativa.';
  end if;

  if v_box_count > 0 and v_units_per_box <= 0 then
    raise exception 'Indica cuantos envases vienen por caja.';
  end if;

  if coalesce(p_units_per_box, 0) < 0 or coalesce(p_loose_units, 0) < 0 then
    raise exception 'Las cantidades de envases no pueden ser negativas.';
  end if;

  if v_quantity <= 0 then
    raise exception 'El ingreso debe tener envases por caja o envases sueltos.';
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
    entry_units_per_box,
    entry_loose_units,
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
    v_box_count,
    v_units_per_box,
    v_loose_units,
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
    concat(
      'Ingreso: ',
      v_box_count,
      ' cajas x ',
      v_units_per_box,
      ' envases + ',
      v_loose_units,
      ' envases sueltos. ',
      coalesce(p_notes, 'Ingreso inicial de lote')
    ),
    p_user_id
  );

  return v_lot_id;
end;
$$;
