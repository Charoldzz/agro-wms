-- ============================================================
-- DIAGNÓSTICO DE DATOS PARA EL PILOTO
-- Pegar completo en Supabase → SQL Editor → Run
-- Muestra cuántos lotes/productos tienen cada problema.
-- Solo lee datos, no modifica nada.
-- ============================================================

-- RESUMEN GENERAL (una fila por chequeo)
SELECT '1. Lotes activos con stock' AS chequeo, count(*)::text AS resultado
FROM public.lots
WHERE inventory_source = 'stock_independiente' AND status = 'activo' AND current_quantity > 0

UNION ALL

SELECT '2. Lotes SIN presentación (package_size vacío o 0) — CRÍTICO', count(*)::text
FROM public.lots
WHERE inventory_source = 'stock_independiente' AND status = 'activo' AND current_quantity > 0
  AND (package_size IS NULL OR package_size = 0)

UNION ALL

SELECT '3. Lotes con tamaño pero SIN unidad (lt/kg) — CRÍTICO', count(*)::text
FROM public.lots
WHERE inventory_source = 'stock_independiente' AND status = 'activo' AND current_quantity > 0
  AND package_size > 0 AND (package_unit IS NULL OR package_unit = '')

UNION ALL

SELECT '4. Productos activos SIN unidades-por-caja en el catálogo', count(DISTINCT upper(l.product))::text
FROM public.lots l
LEFT JOIN public.product_catalog pc
  ON upper(pc.name) = upper(l.product) AND pc.client_id = l.client_id
WHERE l.inventory_source = 'stock_independiente' AND l.status = 'activo' AND l.current_quantity > 0
  AND (pc.units_per_box IS NULL OR pc.units_per_box = 0)

UNION ALL

SELECT '5. Lotes activos SIN fecha de vencimiento', count(*)::text
FROM public.lots
WHERE inventory_source = 'stock_independiente' AND status = 'activo' AND current_quantity > 0
  AND expiry_date IS NULL

UNION ALL

SELECT '6. Lotes activos SIN ubicación', count(*)::text
FROM public.lots
WHERE inventory_source = 'stock_independiente' AND status = 'activo' AND current_quantity > 0
  AND (location IS NULL OR location = '')

UNION ALL

SELECT '7. Empresas con lotes activos', count(DISTINCT client_id)::text
FROM public.lots
WHERE inventory_source = 'stock_independiente' AND status = 'activo' AND current_quantity > 0;

-- ============================================================
-- DETALLE: correr por separado el bloque que dé mayor a 0
-- ============================================================

-- Detalle del chequeo 2 — lotes sin presentación:
-- SELECT c.name AS empresa, l.product, l.lot_code, l.current_quantity
-- FROM public.lots l JOIN public.clients c ON c.id = l.client_id
-- WHERE l.inventory_source = 'stock_independiente' AND l.status = 'activo' AND l.current_quantity > 0
--   AND (l.package_size IS NULL OR l.package_size = 0)
-- ORDER BY c.name, l.product;

-- Detalle del chequeo 3 — lotes sin unidad:
-- SELECT c.name AS empresa, l.product, l.lot_code, l.package_size
-- FROM public.lots l JOIN public.clients c ON c.id = l.client_id
-- WHERE l.inventory_source = 'stock_independiente' AND l.status = 'activo' AND l.current_quantity > 0
--   AND l.package_size > 0 AND (l.package_unit IS NULL OR l.package_unit = '')
-- ORDER BY c.name, l.product;

-- Detalle del chequeo 4 — productos sin cajas en catálogo:
-- SELECT DISTINCT c.name AS empresa, l.product
-- FROM public.lots l
-- JOIN public.clients c ON c.id = l.client_id
-- LEFT JOIN public.product_catalog pc
--   ON upper(pc.name) = upper(l.product) AND pc.client_id = l.client_id
-- WHERE l.inventory_source = 'stock_independiente' AND l.status = 'activo' AND l.current_quantity > 0
--   AND (pc.units_per_box IS NULL OR pc.units_per_box = 0)
-- ORDER BY c.name, l.product;
