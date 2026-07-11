-- Migration: Cambiar formato de número de guía de TAB-NNN a SAL-NNNNN / ING-NNNNN
-- Contadores separados por tipo, secuencia de 5 dígitos

-- 1. Crear contadores SAL e ING, inicializados desde datos existentes
INSERT INTO public.warehouse_operation_counters (counter_name, next_number)
SELECT 'guide_sal',
       coalesce(
         (SELECT max(substring(guide_number FROM 5)::bigint) + 1
          FROM public.warehouse_operations
          WHERE guide_number ~ '^SAL-[0-9]+$'),
         1
       )
ON CONFLICT (counter_name) DO UPDATE
  SET next_number = EXCLUDED.next_number;

INSERT INTO public.warehouse_operation_counters (counter_name, next_number)
SELECT 'guide_ing',
       coalesce(
         (SELECT max(substring(guide_number FROM 5)::bigint) + 1
          FROM public.warehouse_operations
          WHERE guide_number ~ '^ING-[0-9]+$'),
         1
       )
ON CONFLICT (counter_name) DO UPDATE
  SET next_number = EXCLUDED.next_number;

-- 2. Eliminar funciones antiguas sin parámetro
DROP FUNCTION IF EXISTS public.preview_next_warehouse_guide();
DROP FUNCTION IF EXISTS public.next_warehouse_guide();

-- 3. Nueva función de preview con tipo
CREATE OR REPLACE FUNCTION public.preview_next_warehouse_guide(p_type text DEFAULT 'sal')
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE lower(p_type)
    WHEN 'ing' THEN 'ING-' || lpad(next_number::text, 5, '0')
    ELSE              'SAL-' || lpad(next_number::text, 5, '0')
  END
  FROM public.warehouse_operation_counters
  WHERE counter_name = CASE lower(p_type)
    WHEN 'ing' THEN 'guide_ing'
    ELSE             'guide_sal'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_next_warehouse_guide(text) TO authenticated;

-- 4. Nueva función next con tipo
CREATE OR REPLACE FUNCTION public.next_warehouse_guide(p_type text DEFAULT 'sal')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counter text;
  v_prefix  text;
  v_number  bigint;
BEGIN
  IF lower(p_type) = 'ing' THEN
    v_counter := 'guide_ing';
    v_prefix  := 'ING-';
  ELSE
    v_counter := 'guide_sal';
    v_prefix  := 'SAL-';
  END IF;

  UPDATE public.warehouse_operation_counters
  SET next_number = next_number + 1
  WHERE counter_name = v_counter
  RETURNING next_number - 1 INTO v_number;

  IF v_number IS NULL THEN
    INSERT INTO public.warehouse_operation_counters (counter_name, next_number)
    VALUES (v_counter, 2)
    ON CONFLICT (counter_name) DO UPDATE
      SET next_number = public.warehouse_operation_counters.next_number + 1
    RETURNING public.warehouse_operation_counters.next_number - 1 INTO v_number;
  END IF;

  RETURN v_prefix || lpad(v_number::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_warehouse_guide(text) TO authenticated;

-- 5. Actualizar create_entry_operation para usar 'ing'
CREATE OR REPLACE FUNCTION public.create_entry_operation(
  p_client_id uuid,
  p_driver_name text,
  p_driver_document text,
  p_vehicle_plate text,
  p_entry_date date,
  p_photo_url text,
  p_notes text,
  p_items jsonb,
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
  v_item jsonb;
  v_item_id uuid;
  v_lot_id uuid;
  v_line integer := 0;
  v_lot_code text;
  v_product text;
  v_box_count numeric(12, 2);
  v_units_per_box numeric(12, 2);
  v_loose_units numeric(12, 2);
  v_quantity numeric(12, 2);
  v_package_size numeric(12, 2);
  v_location text;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'El usuario del ingreso no coincide con la sesion activa.';
  END IF;

  SELECT role::text INTO v_role
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role NOT IN ('administrador', 'operador') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar ingresos.';
  END IF;

  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'Selecciona el cliente del ingreso.';
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Agrega al menos un producto al ingreso.';
  END IF;

  IF coalesce(trim(p_driver_name), '') = ''
     OR coalesce(trim(p_driver_document), '') = ''
     OR coalesce(trim(p_vehicle_plate), '') = '' THEN
    RAISE EXCEPTION 'Completa chofer, documento y placa del ingreso.';
  END IF;

  v_operation_code := public.new_warehouse_operation_code('ING');
  v_guide_number   := public.next_warehouse_guide('ing');

  INSERT INTO public.warehouse_operations (
    operation_code,
    guide_number,
    type,
    status,
    source,
    client_id,
    driver_name,
    driver_document,
    vehicle_plate,
    notes,
    photo_url,
    created_by
  )
  VALUES (
    v_operation_code,
    v_guide_number,
    'ingreso',
    'aplicado',
    'app',
    p_client_id,
    trim(p_driver_name),
    trim(p_driver_document),
    upper(trim(p_vehicle_plate)),
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_photo_url, '')), ''),
    p_user_id
  )
  RETURNING id INTO v_operation_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_line          := v_line + 1;
    v_product       := trim(coalesce(v_item->>'product', ''));
    v_lot_code      := trim(coalesce(v_item->>'lot_code', ''));
    v_box_count     := greatest(coalesce(nullif(v_item->>'box_count', '')::numeric, 0), 0);
    v_units_per_box := greatest(coalesce(nullif(v_item->>'units_per_box', '')::numeric, 0), 0);
    v_loose_units   := greatest(coalesce(nullif(v_item->>'loose_units', '')::numeric, 0), 0);
    v_package_size  := nullif(v_item->>'package_size', '')::numeric;
    v_location      := trim(coalesce(v_item->>'location', ''));
    v_quantity      := v_box_count * v_units_per_box + v_loose_units;

    IF v_product = '' THEN
      RAISE EXCEPTION 'Cada linea del ingreso necesita producto.';
    END IF;

    IF v_lot_code = '' THEN
      v_lot_code := v_operation_code || '-' || lpad(v_line::text, 2, '0');
    END IF;

    IF v_box_count > 0 AND v_units_per_box <= 0 THEN
      RAISE EXCEPTION 'Indica cuantos envases vienen por caja en %.', v_product;
    END IF;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'La linea % no tiene envases para ingresar.', v_product;
    END IF;

    IF v_location = '' THEN
      RAISE EXCEPTION 'La linea % necesita ubicacion.', v_product;
    END IF;

    INSERT INTO public.lots (
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
      low_stock_threshold,
      inventory_source
    )
    VALUES (
      v_lot_code,
      p_client_id,
      v_product,
      v_quantity,
      v_box_count,
      v_units_per_box,
      v_loose_units,
      v_package_size,
      nullif(trim(coalesce(v_item->>'package_unit', '')), ''),
      v_location,
      coalesce(p_entry_date, current_date),
      nullif(v_item->>'expiry_date', '')::date,
      'activo',
      nullif(trim(coalesce(p_photo_url, '')), ''),
      5,
      'stock_independiente'
    )
    RETURNING id INTO v_lot_id;

    INSERT INTO public.warehouse_operation_items (
      operation_id,
      line_number,
      lot_id,
      lot_code,
      product,
      quantity,
      previous_quantity,
      new_quantity,
      box_count,
      units_per_box,
      loose_units,
      package_size,
      package_unit,
      from_location,
      to_location,
      expiry_date
    )
    VALUES (
      v_operation_id,
      v_line,
      v_lot_id,
      v_lot_code,
      v_product,
      v_quantity,
      0,
      v_quantity,
      v_box_count,
      v_units_per_box,
      v_loose_units,
      v_package_size,
      nullif(trim(coalesce(v_item->>'package_unit', '')), ''),
      null,
      v_location,
      nullif(v_item->>'expiry_date', '')::date
    )
    RETURNING id INTO v_item_id;

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
      v_lot_id,
      'entrada',
      v_quantity,
      0,
      v_quantity,
      null,
      v_location,
      nullif(trim(coalesce(p_notes, '')), ''),
      p_user_id
    );
  END LOOP;

  RETURN jsonb_build_object(
    'operation_id',   v_operation_id,
    'operation_code', v_operation_code,
    'guide_number',   v_guide_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_entry_operation(uuid, text, text, text, date, text, text, jsonb, uuid) TO authenticated;

-- 6. Actualizar create_dispatch_operation para usar 'sal' y permitir lotes vencidos
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
        concat('Recibe: ', trim(p_receiver_name)),
        concat('Documento: ', trim(p_receiver_document)),
        'Despacho por lista',
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
