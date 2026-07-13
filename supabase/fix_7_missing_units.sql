-- Los 7 productos sin unidad detectada — todos son litros
UPDATE public.lots
SET package_unit = 'lt'
WHERE (package_unit IS NULL OR package_unit = '')
  AND package_size IS NOT NULL
  AND package_size > 0
  AND product NOT ILIKE '%bolsa%'
  AND inventory_source = 'stock_independiente';

-- Verificar que no quede ninguno sin unidad
SELECT count(*) as sin_unidad
FROM public.lots
WHERE package_size > 0
  AND (package_unit IS NULL OR package_unit = '')
  AND inventory_source = 'stock_independiente';
