-- Siembra el catálogo desde los lotes para TODAS las empresas (2026-07-10, v2)
-- 1) El código pasa a ser único POR EMPRESA (las dos Tecnomyl comparten códigos TCML)
-- 2) Todo producto con lotes que no tenga ficha en su empresa, la recibe
-- 3) Verificación final: debería salir vacía

-- ============ 1. Código único por empresa ============
alter table public.product_catalog drop constraint if exists product_catalog_code_key;
alter table public.product_catalog
  add constraint product_catalog_client_code_key unique (client_id, code);

-- ============ 2. Sembrar fichas faltantes ============
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
on conflict (client_id, code) do nothing;

-- ============ 3. Verificación ============
-- Empresas con productos en inventario que sigan sin ficha (debería estar vacío)
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
