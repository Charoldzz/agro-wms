-- Correccion puntual: resolver el cliente del despacho desde la cabecera,
-- la solicitud aprobada, las lineas escaneadas o los lotes reales.
-- Ejecutar en Supabase SQL Editor si aparece:
-- "No se pudo definir el cliente del despacho."

create or replace function public.create_dispatch_operation(
  p_client_id uuid,
  p_receiver_name text,
  p_receiver_document text,
  p_vehicle_plate text,
  p_notes text,
  p_items jsonb,
  p_request_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_operation_id uuid;
  v_operation_code text;
  v_guide_number text;
  v_operation_client_id uuid := p_client_id;
  v_item jsonb;
  v_item_id uuid;
  v_lot public.lots%rowtype;
  v_line integer := 0;
  v_lot_id uuid;
  v_quantity numeric(12, 2);
  v_new_quantity numeric(12, 2);
  v_item_client_ids uuid[];
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del despacho no coincide con la sesion activa.';
  end if;

  select role::text into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para registrar despachos.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escanea al menos un lote.';
  end if;

  if coalesce(trim(p_receiver_name), '') = ''
     or coalesce(trim(p_receiver_document), '') = '' then
    raise exception 'Completa quien recibe y su documento.';
  end if;

  select nullif(value->>'lot_id', '')::uuid
  into v_lot_id
  from jsonb_array_elements(p_items)
  limit 1;

  if v_operation_client_id is null and p_request_id is not null then
    select client_id
    into v_operation_client_id
    from public.client_dispatch_requests
    where id = p_request_id;
  end if;

  if v_operation_client_id is null then
    select array_agg(distinct nullif(value->>'client_id', '')::uuid)
    into v_item_client_ids
    from jsonb_array_elements(p_items)
    where nullif(value->>'client_id', '') is not null;

    if coalesce(array_length(v_item_client_ids, 1), 0) = 1 then
      v_operation_client_id := v_item_client_ids[1];
    end if;
  end if;

  if v_operation_client_id is null then
    select client_id
    into v_operation_client_id
    from public.lots
    where id = v_lot_id;
  end if;

  if v_operation_client_id is null then
    select array_agg(distinct l.client_id)
    into v_item_client_ids
    from jsonb_array_elements(p_items) item
    join public.lots l on l.id = nullif(item.value->>'lot_id', '')::uuid
    where l.client_id is not null;

    if coalesce(array_length(v_item_client_ids, 1), 0) = 1 then
      v_operation_client_id := v_item_client_ids[1];
    end if;
  end if;

  if v_operation_client_id is null then
    raise exception 'No se pudo definir el cliente del despacho.';
  end if;

  v_operation_code := public.new_warehouse_operation_code('DESP');
  v_guide_number := public.next_warehouse_guide();

  insert into public.warehouse_operations (
    operation_code,
    guide_number,
    type,
    status,
    source,
    client_id,
    receiver_name,
    receiver_document,
    vehicle_plate,
    notes,
    metadata,
    created_by
  )
  values (
    v_operation_code,
    v_guide_number,
    'despacho',
    'aplicado',
    case when p_request_id is null then 'app' else 'solicitud_cliente' end,
    v_operation_client_id,
    trim(p_receiver_name),
    trim(p_receiver_document),
    nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    case
      when p_request_id is null then '{}'::jsonb
      else jsonb_build_object('client_dispatch_request_id', p_request_id)
    end,
    p_user_id
  )
  returning id into v_operation_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    select * into v_lot
    from public.lots
    where id = v_lot_id
    for update;

    if not found then
      raise exception 'Lote no encontrado en el despacho.';
    end if;

    if v_lot.client_id <> v_operation_client_id then
      raise exception 'Todos los productos del despacho deben pertenecer al mismo cliente.';
    end if;

    if v_quantity <= 0 then
      raise exception 'La cantidad a despachar debe ser mayor a cero.';
    end if;

    if v_lot.status in ('retenido', 'cerrado') then
      raise exception 'No se puede despachar un lote retenido o cerrado.';
    end if;

    if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
      raise exception 'No se puede despachar un lote vencido.';
    end if;

    if v_quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente.';
    end if;

    v_new_quantity := v_lot.current_quantity - v_quantity;

    insert into public.warehouse_operation_items (
      operation_id,
      line_number,
      lot_id,
      lot_code,
      product,
      quantity,
      previous_quantity,
      new_quantity,
      package_size,
      package_unit,
      from_location,
      to_location,
      expiry_date
    )
    values (
      v_operation_id,
      v_line,
      v_lot.id,
      v_lot.lot_code,
      v_lot.product,
      v_quantity,
      v_lot.current_quantity,
      v_new_quantity,
      v_lot.package_size,
      v_lot.package_unit,
      v_lot.location,
      nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
      v_lot.expiry_date
    )
    returning id into v_item_id;

    update public.lots
    set current_quantity = v_new_quantity
    where id = v_lot.id;

    insert into public.movements (
      operation_id,
      operation_item_id,
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
      v_operation_id,
      v_item_id,
      v_lot.id,
      'salida',
      v_quantity,
      v_lot.current_quantity,
      v_new_quantity,
      v_lot.location,
      nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
      concat_ws(
        ' | ',
        nullif(concat('Placa: ', nullif(upper(trim(coalesce(p_vehicle_plate, ''))), '')), 'Placa: '),
        concat('Recibe: ', trim(p_receiver_name)),
        concat('Documento: ', trim(p_receiver_document)),
        'Despacho por lista',
        nullif(trim(coalesce(p_notes, '')), '')
      ),
      p_user_id
    );
  end loop;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'operation_code', v_operation_code,
    'guide_number', v_guide_number,
    'items', v_line
  );
end;
$$;

grant execute on function public.create_dispatch_operation(uuid, text, text, text, text, jsonb, uuid, uuid) to authenticated;
