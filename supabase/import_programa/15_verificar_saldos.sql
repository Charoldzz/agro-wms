-- ============================================================
-- 15 · VERIFICACION CORRECTA de los saldos historicos
--
-- La consulta de control del SQL 14 estaba mal escrita: emparejaba por
-- producto + empresa pero NO por lote, asi que cuando un producto tenia
-- varios lotes los comparaba cruzados. Tampoco contemplaba que los
-- productos en ml/gr guardan el stock en ml/gr y el movimiento en lts/kgs.
--
-- Aca se empareja por la clave real (solucion_mirror_id) y se ajusta la unidad.
-- ============================================================

-- 1) Resumen: los tres numeros tienen que dar 4.214
select
  count(*)                                     as movimientos,
  count(previous_quantity)                     as con_saldo_calculado,
  count(*) filter (where location is not null)  as con_ubicacion
from public.desktop_movements;


-- 2) Control real: el saldo del ULTIMO movimiento de cada lote tiene que
--    coincidir con el stock actual de ese lote.
--    SI ESTA CONSULTA DEVUELVE 0 FILAS, ESTA TODO BIEN.
with ultimo as (
  select distinct on (product_code, warehouse_code, coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'))
         product_code,
         warehouse_code,
         coalesce(nullif(lot,''),'SIN-LOTE')          as lote,
         coalesce(expiry_date::text,'SINVEN')          as venc,
         new_quantity
  from public.desktop_movements
  where warehouse_code is not null
  order by product_code, warehouse_code,
           coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'),
           date desc, id desc
)
select
  u.product_code,
  u.lote,
  u.new_quantity                                  as saldo_del_historico,
  l.current_quantity                              as stock_del_lote,
  l.package_unit,
  round(l.current_quantity - (u.new_quantity *
        case when l.package_unit in ('ml','gr') then 1000 else 1 end), 2) as diferencia
from ultimo u
join public.lots l
  -- clave real: la misma con la que se importaron los lotes
  on l.solucion_mirror_id = u.product_code || '-' || u.warehouse_code || '-' || u.lote || '-' || u.venc
where abs(
        l.current_quantity - (u.new_quantity *
        case when l.package_unit in ('ml','gr') then 1000 else 1 end)
      ) > 0.01
order by abs(l.current_quantity - (u.new_quantity *
         case when l.package_unit in ('ml','gr') then 1000 else 1 end)) desc
limit 30;


-- 3) Cuantos lotes se pudieron emparejar (control de cobertura).
--    emparejados deberia ser ~737 y sin_pareja 0.
with ultimo as (
  select distinct on (product_code, warehouse_code, coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'))
         product_code, warehouse_code,
         coalesce(nullif(lot,''),'SIN-LOTE') as lote,
         coalesce(expiry_date::text,'SINVEN') as venc
  from public.desktop_movements
  where warehouse_code is not null
  order by product_code, warehouse_code,
           coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'),
           date desc, id desc
)
select
  count(*)                    as grupos_en_el_historico,
  count(l.id)                 as emparejados_con_un_lote,
  count(*) - count(l.id)      as sin_pareja
from ultimo u
left join public.lots l
  on l.solucion_mirror_id = u.product_code || '-' || u.warehouse_code || '-' || u.lote || '-' || u.venc;
