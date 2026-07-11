-- FIX create_entry_operation (2026-07-10)
-- El insert en movements usaba la columna "created_by" (no existe: la tabla usa
-- "user_id") y el tipo 'ingreso' (el enum movement_type solo acepta 'entrada').
-- Por eso NINGÚN ingreso web se pudo guardar nunca. La función de salidas ya
-- estaba correcta. Correr UNA VEZ en Supabase SQL Editor.

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
      inventory_source,
      solucion_product_code
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
      'stock_independiente',
      nullif(trim(coalesce(v_item->>'product_code', '')), '')
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
      concat_ws(
        ' | ',
        nullif(concat('Placa: ', nullif(upper(trim(coalesce(p_vehicle_plate, ''))), '')), 'Placa: '),
        concat('Transportista: ', trim(p_driver_name)),
        concat('Documento: ', trim(p_driver_document)),
        'Ingreso manual (app)',
        nullif(trim(coalesce(p_notes, '')), '')
      ),
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

-- Reparación: los lotes creados hoy por la web quedaron con la etiqueta por
-- defecto 'app' (invisibles para la app, que filtra stock_independiente)
UPDATE public.lots
SET inventory_source = 'stock_independiente'
WHERE inventory_source = 'app'
  AND entry_date >= '2026-07-10';

-- Reparación: vincular por código los lotes web ya creados sin código,
-- usando la ficha de catálogo de su misma empresa
UPDATE public.lots l
SET solucion_product_code = pc.code
FROM public.product_catalog pc
WHERE l.inventory_source = 'stock_independiente'
  AND coalesce(l.solucion_product_code, '') = ''
  AND pc.client_id = l.client_id
  AND (
    upper(l.product) = upper(pc.name)
    OR upper(l.product) = upper(pc.name || ' X ' || trim_scale(pc.package_size)::text || ' ' || pc.package_unit)
  );
