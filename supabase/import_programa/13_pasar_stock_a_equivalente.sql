-- ============================================================
-- 13 · PASAR EL STOCK A EQUIVALENTE (lts/kgs)
--
-- Cambio de fondo: hasta ahora la app guardaba la cantidad en ENVASES y
-- calculaba el equivalente al mostrarlo. Desde ahora guarda directamente el
-- EQUIVALENTE (lts/kgs), igual que el programa C#. Los envases se calculan
-- para mostrarlos, no al reves.
--
-- Por que: evita perder precision. Antes una salida de 410 lts de un producto
-- de 20 lts se truncaba a 20 bidones (400 lts) y se perdian 10 litros.
--
-- Se convierten las tres columnas que estaban en envases:
--   current_quantity, entry_loose_units y pallet_units_per_pallet
-- Los productos SIN presentacion no se tocan (ya estaban en unidades sueltas).
--
-- La tabla movements esta vacia (no hubo operaciones en la app todavia),
-- asi que no hay historico que convertir.
--
-- CORRER JUNTO CON EL DEPLOY de la app (v2026.07.19.3 o superior).
-- ============================================================
begin;

update public.lots
set
  current_quantity        = round(current_quantity * package_size, 2),
  entry_loose_units       = round(entry_loose_units * package_size, 2),
  pallet_units_per_pallet = case
                              when pallet_units_per_pallet is null then null
                              else round(pallet_units_per_pallet * package_size, 2)
                            end,
  updated_at              = now()
where package_size is not null
  and package_size > 0;

commit;

-- ============================================================
-- VERIFICACION — tienen que dar EXACTAMENTE lo mismo que antes del cambio
-- ============================================================
select
  count(*)                                             as lotes,
  count(*) filter (where current_quantity > 0)          as con_stock,   -- 398
  round(sum(case when package_unit in ('lt','ml')
       then current_quantity / (case when package_unit='ml' then 1000 else 1 end)
       else 0 end), 2)                                  as total_lts,   -- 1.113.523,55
  round(sum(case when package_unit in ('kg','gr')
       then current_quantity / (case when package_unit='gr' then 1000 else 1 end)
       else 0 end), 2)                                  as total_kgs,   -- 739.580,30
  round(sum(case when package_size is null
       then current_quantity else 0 end), 2)            as uds_sueltas  -- 40.431
from public.lots;

-- El total de pallets no cambia: se multiplican numerador y denominador por lo mismo.
select round(sum(current_quantity / pallet_units_per_pallet), 2) as total_pallets  -- 2.420,07
from public.lots
where pallet_units_per_pallet is not null and pallet_units_per_pallet > 0;
