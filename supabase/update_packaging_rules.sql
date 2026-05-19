alter table public.lots
add column if not exists package_size numeric(12, 2),
add column if not exists package_unit text,
add column if not exists expiry_date date;

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
