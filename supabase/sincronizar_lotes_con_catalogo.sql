-- Sincronizar el NOMBRE y la PRESENTACIÓN de cada lote con su ficha de catálogo,
-- usando la relación real por CÓDIGO (lots.solucion_product_code = product_catalog.code).
-- Repara lotes que quedaron con el nombre viejo/desincronizado tras modificar una ficha.
-- NO toca cantidades ni movimientos. Correr UNA VEZ en el SQL Editor de Supabase.

UPDATE public.lots l
SET product      = pc.name,
    package_size = pc.package_size,
    package_unit = pc.package_unit
FROM public.product_catalog pc
WHERE l.inventory_source = 'stock_independiente'
  AND coalesce(l.solucion_product_code, '') <> ''
  AND upper(l.solucion_product_code) = upper(pc.code)
  AND (
    l.product      IS DISTINCT FROM pc.name
    OR l.package_size IS DISTINCT FROM pc.package_size
    OR l.package_unit IS DISTINCT FROM pc.package_unit
  );

-- Verificación: lotes cuyo nombre TODAVÍA difiere de su ficha (idealmente 0 filas).
-- Si aparece alguno con nombre "duplicado" (ej. "... X 5 LTS X 5 lt"), esa ficha
-- del catálogo tiene el nombre duplicado de un bug viejo: corregila a mano en el
-- Catálogo (Modificar → arreglar el Nombre → Guardar) y volvé a correr este script.
SELECT l.lot_code,
       l.product                 AS nombre_lote,
       pc.name                   AS nombre_ficha,
       l.solucion_product_code   AS codigo
FROM public.lots l
JOIN public.product_catalog pc ON upper(pc.code) = upper(l.solucion_product_code)
WHERE l.inventory_source = 'stock_independiente'
  AND l.product IS DISTINCT FROM pc.name
ORDER BY l.product;
