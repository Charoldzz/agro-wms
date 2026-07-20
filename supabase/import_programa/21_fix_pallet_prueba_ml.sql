-- ============================================================
-- 21 · FIX: cantidad por pallet del producto de prueba en MILILITROS
--
-- Error mio al armar los datos de prueba: en los productos medidos en ml (o gr)
-- el stock se guarda en la unidad CRUDA (50.000 ml), asi que la cantidad por
-- pallet tiene que estar en la MISMA unidad. Le habia puesto 600 pensando en
-- litros, y por eso 50 lts figuraban como 83 pallets.
--
-- Correcto: 600 (lts por pallet) x 1000 = 600.000 ml por pallet.
-- Asi 50.000 ml / 600.000 = 0,08 pallets, que es lo razonable.
--
-- Es el mismo criterio que ya tienen los lotes reales en ml/gr importados
-- del programa (ver la consulta de control al final).
-- ============================================================
begin;

update public.product_catalog
set pallet_units_per_pallet = 600000
where code = 'ZZPR-00004';

update public.lots
set pallet_units_per_pallet = 600000, updated_at = now()
where solucion_product_code = 'ZZPR-00004';

commit;

-- ============================================================
-- VERIFICACION
-- ============================================================
-- 1) Los pallets de la empresa de prueba. Total esperado ~6,40
select
  l.lot_code,
  l.current_quantity,
  l.package_unit,
  l.pallet_units_per_pallet                                as por_pallet,
  round(l.current_quantity / l.pallet_units_per_pallet, 2) as pallets
from public.lots l
join public.clients c on c.id = l.client_id
where c.solucion_codigo = 999 and l.pallet_units_per_pallet is not null
order by l.lot_code;

-- 2) Control del criterio contra los lotes REALES en ml/gr del programa:
--    en todos, por_pallet tiene que ser un numero "grande" (en ml/gr),
--    y los pallets un valor razonable.
select
  l.lot_code,
  cleaned.producto,
  l.current_quantity,
  l.package_unit,
  l.pallet_units_per_pallet                                as por_pallet,
  round(l.current_quantity / l.pallet_units_per_pallet, 2) as pallets
from public.lots l
join lateral (select left(l.product, 34) as producto) cleaned on true
join public.clients c on c.id = l.client_id
where l.package_unit in ('ml', 'gr')
  and l.current_quantity > 0
  and l.pallet_units_per_pallet is not null
  and c.solucion_codigo <> 999
order by pallets desc
limit 15;
