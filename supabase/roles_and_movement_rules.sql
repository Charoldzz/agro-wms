alter type public.user_role add value if not exists 'oficina';

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

  if p_type = 'entrada' then
    v_new_quantity := v_lot.current_quantity + p_quantity;
  elsif p_type = 'salida' then
    if p_quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente.';
    end if;
    if v_lot.package_size is not null and v_lot.package_size > 0 and mod(p_quantity, v_lot.package_size) <> 0 then
      raise exception 'La cantidad debe ser multiplo de la presentacion del producto.';
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
