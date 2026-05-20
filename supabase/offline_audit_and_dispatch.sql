create or replace function public.register_offline_movement(
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
  v_movement_id uuid;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del movimiento no coincide con la sesion activa.';
  end if;

  if p_type <> 'salida' then
    return public.register_movement(p_lot_id, p_type, p_quantity, p_to_location, p_notes, p_user_id);
  end if;

  if p_quantity <= 0 then
    raise exception 'La cantidad debe ser mayor a cero.';
  end if;

  select * into v_lot
  from public.lots
  where id = p_lot_id;

  if not found then
    raise exception 'Lote no encontrado.';
  end if;

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
    concat('[OFFLINE] [REQUIERE REVISION] ', coalesce(p_notes, '')),
    p_user_id,
    'pendiente'
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
  v_lot public.lots%rowtype;
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

  if v_movement.type not in ('ajuste', 'traslado', 'salida') or v_movement.approval_status <> 'pendiente' then
    raise exception 'Este movimiento no esta pendiente de aprobacion.';
  end if;

  select * into v_lot
  from public.lots
  where id = v_movement.lot_id
  for update;

  if not found then
    raise exception 'Lote no encontrado.';
  end if;

  if v_movement.type = 'ajuste' then
    update public.lots
    set current_quantity = v_movement.quantity
    where id = v_movement.lot_id;

    update public.movements
    set new_quantity = v_movement.quantity
    where id = p_movement_id;
  elsif v_movement.type = 'traslado' then
    update public.lots
    set location = v_movement.to_location
    where id = v_movement.lot_id;

    update public.movements
    set new_quantity = v_movement.previous_quantity
    where id = p_movement_id;
  elsif v_movement.type = 'salida' then
    if v_lot.status in ('retenido', 'cerrado') then
      raise exception 'No se puede aprobar salida porque el lote esta retenido o cerrado.';
    end if;

    if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
      raise exception 'No se puede aprobar salida porque el lote esta vencido.';
    end if;

    if v_movement.quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente para aprobar esta salida.';
    end if;

    update public.lots
    set current_quantity = current_quantity - v_movement.quantity
    where id = v_movement.lot_id;

    update public.movements
    set
      previous_quantity = v_lot.current_quantity,
      new_quantity = v_lot.current_quantity - v_movement.quantity
    where id = p_movement_id;
  end if;

  update public.movements
  set
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
    raise exception 'Solo un administrador puede rechazar movimientos pendientes.';
  end if;

  update public.movements
  set
    approval_status = 'rechazado',
    approved_by = p_user_id,
    approved_at = now()
  where id = p_movement_id
    and type in ('ajuste', 'traslado', 'salida')
    and approval_status = 'pendiente';
end;
$$;
