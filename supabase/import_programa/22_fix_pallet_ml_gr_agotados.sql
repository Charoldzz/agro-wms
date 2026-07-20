-- ============================================================
-- 22 · FIX: cantidad por pallet de los productos en ML/GR que quedo en lts/kgs
--
-- QUE PASO: en los productos medidos en ml/gr el stock se guarda en la unidad
-- CRUDA (ej. 1.774.000 gr), asi que la cantidad por pallet tiene que estar en
-- la MISMA unidad (600.000 gr, no 600 kg).
--
-- Los lotes CON stock se corrigieron en su momento (SQL 11), pero los lotes
-- AGOTADOS ya se habian cargado antes de esa correccion y quedaron con el
-- valor en lts/kgs. De ahi el dato paso a la ficha del producto (SQL 16).
--
-- IMPACTO HOY: ninguno, esos lotes tienen stock 0 y aportan 0 pallets.
-- IMPACTO FUTURO: si entra mercaderia de esos productos, el lote nuevo tomaria
-- la cantidad por pallet de la ficha y quedaria 1.000 veces mas chica
-- -> facturaria mal. Por eso se corrige.
--
-- Como se distingue sin riesgo: los valores correctos en ml/gr son grandes
-- (600.000 / 960.000 / 1.000.000) y los incorrectos son chicos (600 / 1.000).
-- El corte en 10.000 los separa limpio, no hay ninguno en el medio.
-- ============================================================
begin;

-- 1) Fichas de producto
update public.product_catalog
set pallet_units_per_pallet = pallet_units_per_pallet * 1000
where package_unit in ('ml', 'gr')
  and pallet_units_per_pallet is not null
  and pallet_units_per_pallet < 10000;

-- 2) Lotes (los agotados que quedaron con el valor viejo)
update public.lots
set pallet_units_per_pallet = pallet_units_per_pallet * 1000,
    updated_at = now()
where package_unit in ('ml', 'gr')
  and pallet_units_per_pallet is not null
  and pallet_units_per_pallet < 10000;

commit;

-- ============================================================
-- VERIFICACION
-- ============================================================
-- 1) No debe quedar NINGUNA fila. Si aparece alguna, quedo algo sin corregir.
select 'LOTE' as donde, l.lot_code as ref, l.package_unit, l.pallet_units_per_pallet
from public.lots l
where l.package_unit in ('ml','gr')
  and l.pallet_units_per_pallet is not null
  and l.pallet_units_per_pallet < 10000
union all
select 'FICHA', pc.code, pc.package_unit, pc.pallet_units_per_pallet
from public.product_catalog pc
where pc.package_unit in ('ml','gr')
  and pc.pallet_units_per_pallet is not null
  and pc.pallet_units_per_pallet < 10000;

-- 2) Los totales generales NO tienen que cambiar (los corregidos tenian stock 0).
select
  round(sum(current_quantity / pallet_units_per_pallet), 2) as total_pallets  -- ~2.420 + los de prueba
from public.lots
where pallet_units_per_pallet is not null and pallet_units_per_pallet > 0;

-- 3) Control general: ningun producto en ml/gr con un valor raro.
select
  package_unit,
  count(*)                            as fichas,
  min(pallet_units_per_pallet)        as minimo,
  max(pallet_units_per_pallet)        as maximo
from public.product_catalog
where package_unit in ('ml','gr') and pallet_units_per_pallet is not null
group by package_unit;
