-- Reparar conceptos de operaciones web creadas ANTES de conceptos_operaciones.sql (2026-07-10)
-- Problema: ING-00210 quedo "Sin concepto" y SAL-01448 quedo "Despacho por lista"
-- porque se crearon antes de aplicar las funciones nuevas. Este script:
--   PASO 1: verifica que las funciones vivas ya generen el concepto nuevo
--   PASO 2: repara los ingresos web con concepto vacio
--   PASO 3: repara las salidas web que dicen "Despacho por lista"
--   PASO 4: muestra como quedaron
-- Correr completo UNA VEZ en Supabase SQL Editor.

-- ============================================================
-- PASO 1 — VERIFICACION: ambas filas deben decir TRUE.
-- Si alguna dice FALSE, volver a correr supabase/conceptos_operaciones.sql
-- ============================================================
SELECT
  p.proname AS funcion,
  CASE p.proname
    WHEN 'create_entry_operation'    THEN p.prosrc LIKE '%Ingreso manual (app)%'
    WHEN 'create_dispatch_operation' THEN p.prosrc LIKE '%Despacho manual (app)%'
  END AS concepto_nuevo_activo
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('create_entry_operation', 'create_dispatch_operation');

-- ============================================================
-- PASO 2 — Ingresos web sin concepto: reconstruirlo desde la operacion
-- ============================================================
UPDATE public.movements m
SET notes = concat_ws(
      ' | ',
      nullif(concat('Placa: ', nullif(upper(trim(coalesce(o.vehicle_plate, ''))), '')), 'Placa: '),
      nullif(concat('Transportista: ', nullif(trim(coalesce(o.driver_name, '')), '')), 'Transportista: '),
      nullif(concat('Documento: ', nullif(trim(coalesce(o.driver_document, '')), '')), 'Documento: '),
      'Ingreso manual (app)',
      nullif(trim(coalesce(o.notes, '')), '')
    )
FROM public.warehouse_operations o
WHERE o.id = m.operation_id
  AND o.type = 'ingreso'
  AND m.type = 'entrada'
  AND coalesce(trim(m.notes), '') = '';

-- ============================================================
-- PASO 3 — Salidas web con la etiqueta vieja "Despacho por lista":
-- reemplazarla por la etiqueta nueva segun si vino de solicitud o fue manual
-- ============================================================
UPDATE public.movements m
SET notes = replace(
      m.notes,
      'Despacho por lista',
      CASE
        WHEN o.source = 'solicitud_cliente'
          OR (o.metadata ? 'client_dispatch_request_id')
        THEN 'Despacho de solicitud del cliente'
        ELSE 'Despacho manual (app)'
      END
    )
FROM public.warehouse_operations o
WHERE o.id = m.operation_id
  AND m.notes LIKE '%Despacho por lista%';

-- ============================================================
-- PASO 4 — Ver como quedaron los conceptos de las operaciones web
-- ============================================================
SELECT
  o.guide_number AS nota,
  o.type         AS tipo,
  m.notes        AS concepto
FROM public.movements m
JOIN public.warehouse_operations o ON o.id = m.operation_id
ORDER BY o.guide_number, m.created_at;
