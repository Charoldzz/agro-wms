-- Siembra el catálogo desde los lotes para TODAS las empresas (2026-07-10)
-- Todo producto con lotes que no tenga ficha de catálogo en su empresa, la recibe
-- (con su código real, presentación y unidad). Así ninguna empresa queda sin
-- productos en el desplegable del ingreso.

insert into public.product_catalog (client_id, code, name, package_size, package_unit)
select distinct on (l.client_id, upper(l.product))
  l.client_id, l.solucion_product_code, l.product, l.package_size, l.package_unit
from public.lots l
where l.inventory_source = 'stock_independiente'
  and coalesce(l.solucion_product_code, '') <> ''
  and not exists (
    select 1 from public.product_catalog pc
    where pc.client_id = l.client_id
      and upper(pc.name) = upper(l.product)
  )
order by l.client_id, upper(l.product), l.current_quantity desc
on conflict (code) do nothing;

-- Verificación 1: empresas con lotes que aún queden sin fichas de catálogo (debería estar vacío)
select c.name as empresa, count(distinct upper(l.product)) as productos_sin_ficha
from public.lots l
join public.clients c on c.id = l.client_id
where l.inventory_source = 'stock_independiente'
  and not exists (
    select 1 from public.product_catalog pc
    where pc.client_id = l.client_id and upper(pc.name) = upper(l.product)
  )
group by c.name
order by 2 desc;
