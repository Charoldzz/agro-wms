-- Agrega campo units_per_box al catálogo de productos
ALTER TABLE public.product_catalog
  ADD COLUMN IF NOT EXISTS units_per_box INTEGER;

-- Verificar resultado
SELECT id, code, name, package_size, package_unit, units_per_box
FROM public.product_catalog
ORDER BY code
LIMIT 20;
