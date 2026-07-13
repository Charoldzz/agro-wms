-- Salidas: el concepto dice "Transportista:" en vez de "Recibe:" (2026-07-13)
-- 1) Repara los movimientos ya guardados
-- 2) Reemplaza create_dispatch_operation para que las salidas nuevas
--    guarden "Transportista:" (igual que los ingresos)
-- Correr UNA VEZ en Supabase SQL Editor.

-- ============================================================
-- PASO 1 — Reparar los conceptos existentes
-- ============================================================
UPDATE public.movements
SET notes = replace(notes, 'Recibe: ', 'Transportista: ')
WHERE notes LIKE '%Recibe: %';

-- ============================================================
-- PASO 2 — Funcion de despacho con la etiqueta nueva
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_dispatch_operation(
  p_client_id uuid,
  p_receiver_name text,
  p_receiver_document text,
  p_vehicle_plate text,
  p_notes text,
  p_items jsonb,
  p_request_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'El usuario del despacho no coincide con la sesion activa.';
  END IF;

  SELECT role::text INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role NOT IN ('administrador', 'operador') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar despachos.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Escanea al menos un lote.';
  END IF;

  IF coalesce(trim(p_receiver_name), '') = ''
     OR coalesce(trim(p_receiver_document), '') = '' THEN
    RAISE EXCEPTION 'Completa quien recibe y su documento.';
  END IF;

  SELECT nullif(value->>'lot_id', '')::uuid
  INTO v_lot_id
  FROM jsonb_array_elements(p_items)
  LIMIT 1;

  IF v_operation_client_id IS NULL AND p_request_id IS NOT NULL THEN
    SELECT client_id
    INTO v_operation_client_id
    FROM public.client_dispatch_requests
    WHERE id = p_request_id;
  END IF;

  IF v_operation_client_id IS NULL THEN
    SELECT array_agg(DISTINCT nullif(value->>'client_id', '')::uuid)
    INTO v_item_client_ids
    FROM jsonb_array_elements(p_items)
    WHERE nullif(value->>'client_id', '') IS NOT NULL;

    IF coalesce(array_length(v_item_client_ids, 1), 0) = 1 THEN
      v_operation_client_id := v_item_client_ids[1];
    END IF;
  END IF;

  IF v_operation_client_id IS NULL THEN
    SELECT client_id
    INTO v_operation_client_id
    FROM public.lots
    WHERE id = v_lot_id;
  END IF;

  IF v_operation_client_id IS NULL THEN
    SELECT array_agg(DISTINCT l.client_id)
    INTO v_item_client_ids
    FROM jsonb_array_elements(p_items) item
    JOIN public.lots l ON l.id = nullif(item.value->>'lot_id', '')::uuid
    WHERE l.client_id IS NOT NULL;

    IF coalesce(array_length(v_item_client_ids, 1), 0) = 1 THEN
      v_operation_client_id := v_item_client_ids[1];
    END IF;
  END IF;

  IF v_operation_client_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo definir el cliente del despacho.';
  END IF;

  v_operation_code := public.new_warehouse_operation_code('DESP');
  v_guide_number   := public.next_warehouse_guide('sal');

  INSERT INTO public.warehouse_operations (
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
  VALUES (
    v_operation_code,
    v_guide_number,
    'despacho',
    'aplicado',
    CASE WHEN p_request_id IS NULL THEN 'app' ELSE 'solicitud_cliente' END,
    v_operation_client_id,
    trim(p_receiver_name),
    trim(p_receiver_document),
    nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    CASE
      WHEN p_request_id IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('client_dispatch_request_id', p_request_id)
    END,
    p_user_id
  )
  RETURNING id INTO v_operation_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_line     := v_line + 1;
    v_lot_id   := nullif(v_item->>'lot_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    SELECT * INTO v_lot
    FROM public.lots
    WHERE id = v_lot_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lote no encontrado en el despacho.';
    END IF;

    IF v_lot.client_id <> v_operation_client_id THEN
      RAISE EXCEPTION 'Todos los productos del despacho deben pertenecer al mismo cliente.';
    END IF;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'La cantidad a despachar debe ser mayor a cero.';
    END IF;

    IF v_lot.status IN ('retenido', 'cerrado') THEN
      RAISE EXCEPTION 'No se puede despachar un lote retenido o cerrado.';
    END IF;

    IF v_quantity > v_lot.current_quantity THEN
      RAISE EXCEPTION 'No hay inventario suficiente.';
    END IF;

    v_new_quantity := v_lot.current_quantity - v_quantity;

    INSERT INTO public.warehouse_operation_items (
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
    VALUES (
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
    RETURNING id INTO v_item_id;

    UPDATE public.lots
    SET current_quantity = v_new_quantity
    WHERE id = v_lot.id;

    INSERT INTO public.movements (
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
    VALUES (
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
        concat('Transportista: ', trim(p_receiver_name)),
        concat('Documento: ', trim(p_receiver_document)),
        CASE WHEN p_request_id IS NULL THEN 'Despacho manual (app)' ELSE 'Despacho de solicitud del cliente' END,
        nullif(trim(coalesce(p_notes, '')), '')
      ),
      p_user_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'operation_id',   v_operation_id,
    'operation_code', v_operation_code,
    'guide_number',   v_guide_number,
    'items',          v_line
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_dispatch_operation(uuid, text, text, text, text, jsonb, uuid, uuid) TO authenticated;

-- ============================================================
-- Verificacion: no debe quedar ningun "Recibe:" en los conceptos
-- ============================================================
SELECT count(*) AS conceptos_con_recibe
FROM public.movements
WHERE notes LIKE '%Recibe: %';
