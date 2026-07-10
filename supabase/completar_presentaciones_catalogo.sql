-- Completa package_size / package_unit en TODO el catálogo (2026-07-10)
-- Paso 1: copia la presentación desde los lotes (dato verificado, mismo cliente + mismo producto)
-- Paso 2: para fichas sin lote, la lee del nombre (patrones: "X 5 Lts", "_5L_BO", "10KG_BO", "(200)L", LTR, gr, ml)
-- Paso 3: lista lo que quede sin presentación para revisión manual

-- ============ PASO 1: desde los lotes ============
update public.product_catalog pc
set package_size = l.package_size, package_unit = l.package_unit
from (
  select distinct on (client_id, upper(product))
    client_id, upper(product) as uname, package_size, package_unit
  from public.lots
  where inventory_source = 'stock_independiente'
    and package_size > 0
  order by client_id, upper(product), current_quantity desc
) l
where pc.client_id = l.client_id
  and upper(pc.name) = l.uname
  and coalesce(pc.package_size, 0) = 0;

-- ============ PASO 2: desde el nombre ============
update public.product_catalog
set
  package_size = replace((regexp_match(name, '([0-9]+(?:[.,][0-9]+)?)[\s)]*(?:ltr|lts?|l|kgs?|grs?|gr|ml)(?![a-zA-Z])', 'i'))[1], ',', '.')::numeric,
  package_unit = case lower((regexp_match(name, '[0-9]+(?:[.,][0-9]+)?[\s)]*(ltr|lts?|l|kgs?|grs?|gr|ml)(?![a-zA-Z])', 'i'))[1])
    when 'l' then 'lt' when 'lt' then 'lt' when 'lts' then 'lt' when 'ltr' then 'lt'
    when 'kg' then 'kg' when 'kgs' then 'kg'
    when 'gr' then 'gr' when 'grs' then 'gr'
    when 'ml' then 'ml'
    else null
  end
where coalesce(package_size, 0) = 0
  and name ~* '[0-9]+(?:[.,][0-9]+)?[\s)]*(ltr|lts?|l|kgs?|grs?|gr|ml)(?![a-zA-Z])';

-- ============ PASO 3: verificación ============
-- Lo que salga aquí hay que completarlo a mano en la pantalla Catálogo
select c.name as empresa, pc.name as producto
from public.product_catalog pc
join public.clients c on c.id = pc.client_id
where coalesce(pc.package_size, 0) = 0
order by c.name, pc.name;
