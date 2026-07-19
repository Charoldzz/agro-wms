-- ============================================================
-- 08 · CORRECCION DE CANTIDADES  (IMPORTANTE — correr una sola vez)
--
-- PROBLEMA detectado:
-- En el programa C#, el campo Quantity de cada movimiento YA ESTA en el
-- equivalente (litros/kilos), NO en cantidad de envases.
-- Evidencia: un movimiento de "OPTIMUS B x 5 Lt." con Quantity=50 trae el
-- desglose "2 cajas + 2 sueltos" => 50 lt = 10 envases de 5 lt = 2 cajas de 4 + 2.
-- Y "NUTRIGROW x 20 LT." con Quantity=4000 trae "200 bidones" => 200 x 20 = 4000 lt.
--
-- La web guarda en lots.current_quantity la cantidad de ENVASES y calcula
-- el equivalente como current_quantity * package_size. Al haber cargado los
-- litros como si fueran envases, el equivalente quedaba multiplicado 2 veces.
--
-- SOLUCION: dividir por el tamaño del envase para pasar de equivalente a envases.
-- Lo mismo con pallet_units_per_pallet (CantidadPorPallet tambien viene en lt/kg:
-- ej. categoria "200 LTS" = 800 por pallet = 4 tambores de 200 lt).
--
-- Los productos SIN presentacion (package_size null) NO se tocan: su cantidad
-- ya esta en unidades sueltas y es correcta.
--
-- El TOTAL DE PALLETS no cambia: se dividen numerador y denominador por lo mismo.
-- ============================================================
begin;

update public.lots
set
  current_quantity        = round(current_quantity / package_size, 2),
  entry_loose_units       = round(current_quantity / package_size, 2),
  pallet_units_per_pallet = case
                              when pallet_units_per_pallet is null then null
                              else round(pallet_units_per_pallet / package_size, 2)
                            end,
  updated_at              = now()
where package_size is not null
  and package_size > 0;

commit;

-- ============================================================
-- VERIFICACION — estos son los numeros que tienen que salir
-- ============================================================
select
  count(*)                                              as lotes,
  round(sum(case when package_unit in ('lt','ml')
                 then current_quantity * package_size / (case when package_unit='ml' then 1000 else 1 end)
                 else 0 end), 2)                        as total_lts,      -- esperado ~1.113.003,52
  round(sum(case when package_unit in ('kg','gr')
                 then current_quantity * package_size / (case when package_unit='gr' then 1000 else 1 end)
                 else 0 end), 2)                        as total_kgs,      -- esperado ~733.270,32
  round(sum(case when package_size is null
                 then current_quantity else 0 end), 2)   as uds_sueltas     -- esperado 40.431
from public.lots;

-- El total de pallets debe seguir dando ~2.420,07 (no cambia).
select round(sum(current_quantity / pallet_units_per_pallet), 2) as total_pallets
from public.lots
where pallet_units_per_pallet is not null and pallet_units_per_pallet > 0;
