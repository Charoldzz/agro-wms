-- Fix manual para lotes con patrones especiales no cubiertos por el regex general

-- CALLIQUAT (200)L → 200 lt
UPDATE public.lots
SET package_size = 200, package_unit = 'lt'
WHERE product ILIKE '%CALLIQUAT%'
  AND product ILIKE '%(200)L%'
  AND (package_size IS NULL OR package_size = 0);

-- MANCOLAXYL 500 GM → 500 gr
UPDATE public.lots
SET package_size = 500, package_unit = 'gr'
WHERE product ILIKE '%MANCOLAXYL%'
  AND product ~* '500\s*gm'
  AND (package_size IS NULL OR package_size = 0);

-- UPLIFT TRIO 2x10 Kk → 10 kg (Kk es typo de Kg)
UPDATE public.lots
SET package_size = 10, package_unit = 'kg'
WHERE product ILIKE '%UPLIFT TRIO%'
  AND product ~* '2x10\s*kk'
  AND (package_size IS NULL OR package_size = 0);

-- Verificar cuántos quedan
SELECT count(*) as sin_dato_restantes
FROM public.lots l
LEFT JOIN public.clients c ON c.id = l.client_id
WHERE (l.package_size IS NULL OR l.package_size = 0)
  AND l.product NOT ILIKE '%bolsa%'
  AND c.name NOT ILIKE '%tecnomyl%';
