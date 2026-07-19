-- ============================================================
-- 11 · ARREGLO de los lotes con presentacion en ML o GR
--
-- PROBLEMA: el campo Quantity del programa viene en LITROS/KILOS, pero estos
-- productos tienen el envase medido en ML o GR. Al dividir directamente
-- (ej. 1,3 lt / 500 ml) el resultado quedaba ~0.
-- Correcto: pasar a la misma unidad primero -> 1,3 lt = 1300 ml / 500 ml = 2,6 envases.
--
-- Se corrigen 13 lotes con valores calculados uno por uno desde el programa.
-- Los lotes agotados (saldo 0) no necesitan arreglo.
-- ============================================================
begin;

-- CALSICO PLUS X 500 Grs  ->  85.5 kgs = 171 envases de 500 gr
update public.lots set current_quantity = 171.0, entry_loose_units = 171.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'MAXI-00007-44-SNCN2505-2027-05-20';

-- CANCORE x 500 Gr.  ->  200 kgs = 400 envases de 500 gr
update public.lots set current_quantity = 400.0, entry_loose_units = 400.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'MAXI-00008-44-25RFS5995-2027-12-16';

-- FIPRONIX x 500 Grs.  ->  1774 kgs = 3548 envases de 500 gr
update public.lots set current_quantity = 3548.0, entry_loose_units = 3548.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'MAXI-00016-44-SNFR2505-2027-05-15';

-- FOLICIST BOL X 250 ML  ->  96 lts = 384 envases de 250 ml
update public.lots set current_quantity = 384.0, entry_loose_units = 384.0, pallet_units_per_pallet = 4000.0, updated_at = now()
where solucion_mirror_id = 'DISA-00011-47-T01796-SINVEN';

-- MATAPOL X 500 GRS  ->  3458 kgs = 6916 envases de 500 gr
update public.lots set current_quantity = 6916.0, entry_loose_units = 6916.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'MAXI-00032-44-20250629-2027-06-29';

-- MICROFOL COMBI BOL X 250 ML  ->  95.75 lts = 383 envases de 250 ml
update public.lots set current_quantity = 383.0, entry_loose_units = 383.0, pallet_units_per_pallet = 4000.0, updated_at = now()
where solucion_mirror_id = 'DISA-00024-47-BT01806-SINVEN';

-- MULTIGIBE X 500 ML  ->  47.5 lts = 95 envases de 500 ml
update public.lots set current_quantity = 95.0, entry_loose_units = 95.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'MAXI-00034-44-SIN-LOTE-SINVEN';

-- NOVASPRING x 500 grs.  ->  176 kgs = 352 envases de 500 gr
update public.lots set current_quantity = 352.0, entry_loose_units = 352.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'ZEBI-00004-48-SFF5L001-2027-12-03';

-- RENO (THIAMETHOXAN 70 WDG X 500 GR (5170114)  ->  500 kgs = 1000 envases de 500 gr
update public.lots set current_quantity = 1000.0, entry_loose_units = 1000.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'AGRO-00007-55-20251205-2027-12-04';

-- RENO X 500 grs.  ->  100 kgs = 200 envases de 500 gr
update public.lots set current_quantity = 200.0, entry_loose_units = 200.0, pallet_units_per_pallet = 1200.0, updated_at = now()
where solucion_mirror_id = 'ADSP-00024-41-20251205-2027-12-04';

-- SLIKON X 500 ML  ->  1.3 lts = 2.6 envases de 500 ml
update public.lots set current_quantity = 2.6, entry_loose_units = 2.6, pallet_units_per_pallet = 2000.0, updated_at = now()
where solucion_mirror_id = 'TCML-00036-24-SIN-LOTE-SINVEN';

-- TAURUS x 200 Grs.  ->  22.8 kgs = 114 envases de 200 gr
update public.lots set current_quantity = 114.0, entry_loose_units = 114.0, pallet_units_per_pallet = 3000.0, updated_at = now()
where solucion_mirror_id = 'MAXI-00048-44-HB-AM19072-2026-07-19';

-- ZAPPIT X 250 ML  ->  280 lts = 1120 envases de 250 ml
update public.lots set current_quantity = 1120.0, entry_loose_units = 1120.0, pallet_units_per_pallet = 4000.0, updated_at = now()
where solucion_mirror_id = 'TCML-00052-24-15/24-2026-02-28';

commit;

-- ============================================================
-- VERIFICACION
-- ============================================================
select count(*) as lotes_totales,
       count(*) filter (where current_quantity > 0) as con_stock,   -- esperado 398
       count(*) filter (where current_quantity = 0) as agotados      -- esperado 339
from public.lots;

select
  round(sum(case when package_unit in ('lt','ml')
       then current_quantity * package_size / (case when package_unit='ml' then 1000 else 1 end)
       else 0 end), 2) as total_lts,     -- esperado 1.113.523,55
  round(sum(case when package_unit in ('kg','gr')
       then current_quantity * package_size / (case when package_unit='gr' then 1000 else 1 end)
       else 0 end), 2) as total_kgs,     -- esperado 739.580,30
  round(sum(case when package_size is null then current_quantity else 0 end), 2) as uds_sueltas
from public.lots;
