-- ============================================================
-- NÚMERO DE TRASPASO CORRELATIVO (TRP-00001, TRP-00002, …)
--
-- El código del traspaso se estaba generando como
-- 'TRP-20260801-d0a6': fecha + 4 caracteres al azar. No sigue la convención
-- del resto de la app, que numera secuencial con un contador
-- (ING-00914, SAL-01502), y esos caracteres random no le dicen nada a nadie.
--
-- Se pasa al MISMO mecanismo: contador en warehouse_operation_counters, así
-- los traspasos quedan numerados 1, 2, 3… y se puede saber cuántos van y
-- referirse a uno por su número.
--
-- Correr DESPUÉS de traspaso_operacion.sql. Idempotente.
-- ============================================================

-- Contador propio para traspasos (arranca en 1, o sigue desde el mayor
-- existente si ya se registró alguno con el formato nuevo)
INSERT INTO public.warehouse_operation_counters (counter_name, next_number)
SELECT 'guide_trp',
       coalesce(
         (SELECT max(substring(operation_code FROM 5)::bigint) + 1
          FROM public.transfer_operations
          WHERE operation_code ~ '^TRP-[0-9]+$'),
         1
       )
ON CONFLICT (counter_name) DO NOTHING;

-- Se agrega el tipo 'trp' a la función que ya numera ingresos y salidas,
-- para tener un solo mecanismo de numeración en toda la app.
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
  ELSIF lower(p_type) = 'trp' THEN
    v_counter := 'guide_trp';
    v_prefix  := 'TRP-';
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

-- El traspaso ahora toma su número del contador
CREATE OR REPLACE FUNCTION public.request_transfer_operation(
  p_from_client_id uuid,
  p_to_client_id   uuid,
  p_notes          text,
  p_items          jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role   text;
  v_name   text;
  v_op     uuid;
  v_code   text;
  v_item   jsonb;
  v_lot    public.lots%rowtype;
  v_qty    numeric(12, 2);
  v_count  integer := 0;
  v_prefix text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p where p.id = auth.uid();

  if coalesce(v_role, '') not in ('administrador', 'operador') then
    raise exception 'No tenés permiso para registrar un traspaso.';
  end if;

  if coalesce(btrim(p_notes), '') = '' then
    raise exception 'Escribí el motivo del traspaso.';
  end if;

  if p_from_client_id is null or p_to_client_id is null then
    raise exception 'Elegí la empresa que vende y la que recibe.';
  end if;

  if p_from_client_id = p_to_client_id then
    raise exception 'La empresa que vende y la que recibe no pueden ser la misma.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un lote al traspaso.';
  end if;

  -- Se valida el código de empresa ACÁ, no al aprobar: así el operador se
  -- entera al instante y no pierde todo lo que cargó.
  select product_code_prefix into v_prefix from public.clients where id = p_to_client_id;
  if coalesce(btrim(v_prefix), '') = '' then
    raise exception 'La empresa que recibe no tiene código de empresa asignado. Un administrador debe cargarlo en Empresas antes de traspasar.';
  end if;

  v_code := public.next_warehouse_guide('trp');

  insert into public.transfer_operations (
    operation_code, from_client_id, to_client_id, notes, created_by, created_by_name
  ) values (
    v_code, p_from_client_id, p_to_client_id, btrim(p_notes), auth.uid(), v_name
  )
  returning id into v_op;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;

    select * into v_lot from public.lots
    where id = nullif(v_item->>'lot_id', '')::uuid
    for update;

    if not found then
      raise exception 'Uno de los lotes no existe.';
    end if;

    if v_lot.client_id <> p_from_client_id then
      raise exception 'El lote % no es de la empresa que vende.', v_lot.lot_code;
    end if;

    if v_lot.status <> 'activo' then
      raise exception 'El lote % no está activo (está %).', v_lot.lot_code, v_lot.status;
    end if;

    v_qty := coalesce(nullif(v_item->>'quantity', '')::numeric, v_lot.current_quantity);

    if v_qty <= 0 then
      raise exception 'La cantidad del lote % debe ser mayor a cero.', v_lot.lot_code;
    end if;

    if v_qty > v_lot.current_quantity then
      raise exception 'El lote % no tiene tanto stock (hay %).',
        v_lot.lot_code, trim(to_char(v_lot.current_quantity, 'FM999999990.99'));
    end if;

    if exists (select 1 from public.lot_transfers t
               left join public.transfer_operations o on o.id = t.operation_id
               where t.lot_id = v_lot.id and coalesce(o.status, t.status) = 'pendiente') then
      raise exception 'El lote % ya está en otro traspaso esperando aprobación.', v_lot.lot_code;
    end if;

    insert into public.lot_transfers (
      operation_id, lot_id, from_client_id, to_client_id, lot_code, product,
      quantity, notes, created_by, created_by_name
    ) values (
      v_op, v_lot.id, p_from_client_id, p_to_client_id, v_lot.lot_code, v_lot.product,
      v_qty, btrim(p_notes), auth.uid(), v_name
    );

    -- Se congela el lote COMPLETO aunque el traspaso sea parcial: si se
    -- dejara operar el sobrante, podrían despacharlo y al aprobar ya no
    -- habría stock suficiente para cumplir.
    update public.lots set status = 'retenido', updated_at = now() where id = v_lot.id;
  end loop;

  return jsonb_build_object('operation_id', v_op, 'operation_code', v_code, 'items', v_count);
end;
$$;

grant execute on function public.request_transfer_operation(uuid, uuid, text, jsonb) to authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select operation_code, status, created_at from public.transfer_operations order by created_at desc;
-- select counter_name, next_number from public.warehouse_operation_counters;
