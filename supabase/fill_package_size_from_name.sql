-- Auto-completar package_size y package_unit desde el nombre del producto
-- Patrón: "x 20lts", "X 5 Kgs.", "x 1 Lt.", "x 500ml", etc.

-- PASO 1: Preview — verificar qué se extraería antes de actualizar
SELECT
  product,
  package_size,
  package_unit,
  (regexp_match(product, '[xX]\s+(\d+(?:[.,]\d+)?)\s*(?:lts?|kgs?|gr|ml|cc)', 'i'))[1]        AS nuevo_size,
  (regexp_match(product, '[xX]\s+\d+(?:[.,]\d+)?\s*(lts?|kgs?|gr|ml|cc)', 'i'))[1]             AS nuevo_unit_raw
FROM public.lots
WHERE (package_size IS NULL OR package_size = 0)
  AND product ~* '[xX]\s+\d+(?:[.,]\d+)?\s*(?:lts?|kgs?|gr|ml|cc)'
ORDER BY product
LIMIT 40;

-- PASO 2: Aplicar la actualización (correr solo después de revisar el preview)
/*
UPDATE public.lots
SET
  package_size = replace(
    (regexp_match(product, '[xX]\s+(\d+(?:[.,]\d+)?)\s*(?:lts?|kgs?|gr|ml|cc)', 'i'))[1],
    ',', '.'
  )::numeric,
  package_unit = CASE lower(trim(
    (regexp_match(product, '[xX]\s+\d+(?:[.,]\d+)?\s*(lts?|kgs?|gr|ml|cc)', 'i'))[1]
  ))
    WHEN 'lts' THEN 'lt'
    WHEN 'kgs' THEN 'kg'
    WHEN 'cc'  THEN 'ml'
    ELSE lower(trim(
      (regexp_match(product, '[xX]\s+\d+(?:[.,]\d+)?\s*(lts?|kgs?|gr|ml|cc)', 'i'))[1]
    ))
  END
WHERE (package_size IS NULL OR package_size = 0)
  AND product ~* '[xX]\s+\d+(?:[.,]\d+)?\s*(?:lts?|kgs?|gr|ml|cc)';
*/

-- PASO 3: Verificar cuántos quedaron sin dato después del update
/*
SELECT count(*) AS todavia_sin_dato
FROM public.lots
WHERE package_size IS NULL OR package_size = 0;
*/
