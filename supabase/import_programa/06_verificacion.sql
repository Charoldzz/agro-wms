-- ============================================================
-- 06 · VERIFICACION POST-IMPORTACION (solo consulta, no cambia nada)
-- ============================================================

-- 1) Resumen general
select 'RESUMEN' as bloque, *
from (
  select
    (select count(*) from public.clients)                                    as empresas,
    (select count(*) from public.product_catalog)                            as productos,
    (select count(*) from public.lots)                                       as lotes,
    (select count(*) from public.lots where current_quantity > 0)             as lotes_con_stock,
    (select count(*) from public.lots where package_size is not null)         as lotes_con_presentacion,
    (select count(*) from public.lots where expiry_date is not null)          as lotes_con_vencimiento,
    (select count(*) from public.desktop_movements)                           as historico
) t;

-- 2) Usuarios: cuales quedaron sin empresa asignada (IMPORTANTE para el portal cliente)
select
  'USUARIOS' as bloque,
  p.role::text            as rol,
  p.full_name             as nombre,
  coalesce(c.name, '(SIN EMPRESA ASIGNADA)') as empresa
from public.profiles p
left join public.clients c on c.id = p.client_id
order by p.role::text, p.full_name;

-- 3) Stock por empresa (para comparar contra el programa)
select
  'STOCK POR EMPRESA' as bloque,
  c.solucion_codigo   as cod,
  c.name              as empresa,
  count(l.id)         as lotes,
  count(l.expiry_date) as con_vencimiento
from public.clients c
left join public.lots l on l.client_id = c.id
group by c.solucion_codigo, c.name
order by count(l.id) desc, c.name;

-- 4) Control de integridad: nada de esto deberia devolver filas
select 'PROBLEMA: lote sin empresa' as alerta, lot_code, product
from public.lots where client_id is null
union all
select 'PROBLEMA: lote sin ficha en catalogo', l.lot_code, l.product
from public.lots l
left join public.product_catalog pc on pc.code = l.solucion_product_code
where pc.code is null
union all
select 'PROBLEMA: cantidad negativa o cero', lot_code, product
from public.lots where current_quantity <= 0;
