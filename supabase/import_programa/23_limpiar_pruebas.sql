-- ============================================================
-- 23 · LIMPIAR LOS MOVIMIENTOS DE PRUEBA sobre empresas REALES  (v2)
--
-- v1 fallaba con: relation "_lotes_tocados" does not exist. Usaba una tabla
-- temporal con ON COMMIT DROP y el editor de Supabase la descartaba antes de
-- usarla. Esta version NO usa tablas temporales.
--
-- Ademas es IDEMPOTENTE: se puede correr las veces que haga falta, incluso si
-- la primera corrida alcanzo a borrar algo. Siempre deja el mismo resultado.
--
-- QUE SE BORRA:
--   · Todos los movimientos, operaciones y solicitudes hechos EN LA APP.
--     Tras la importacion la tabla movements quedo VACIA, asi que todo lo que
--     hay ahi es de prueba. El historico del programa NO se toca.
--   · Los lotes que creo la app desde cero (no tienen solucion_mirror_id),
--     como el CLORAM 4662 del ingreso de prueba.
--
-- QUE NO SE BORRA:
--   · La empresa de prueba ZZZ (codigo 999) y sus 6 lotes: sus lotes SI tienen
--     solucion_mirror_id ('ZZPR-999-...'), asi que quedan a salvo.
--   · Empresas, catalogo, lotes importados ni el historico del programa.
--
-- COMO SE RESTAURA EL STOCK: no se escribe ninguna cantidad a mano. TODOS los
-- lotes que vienen del programa vuelven al saldo del ULTIMO movimiento de su
-- historial (desktop_movements.new_quantity), que es la fuente autoritativa.
-- Los que nunca se tocaron ya coinciden, asi que para ellos no cambia nada.
-- Para productos en ml/gr se aplica el factor 1000 (el historico esta en
-- lts/kgs y el lote guarda ml/gr).
-- ============================================================
begin;

-- Se desactiva el candado que impide borrar movimientos (se reactiva al final)
do $$
begin
  if exists (select 1 from pg_trigger
             where tgname = 'movements_prevent_delete'
               and tgrelid = 'public.movements'::regclass and not tgisinternal) then
    alter table public.movements disable trigger movements_prevent_delete;
  end if;
end $$;

-- 1) Borrar todo lo que se hizo en la app (todo es de prueba)
delete from public.movements;
delete from public.warehouse_operation_items;
delete from public.warehouse_operations;
delete from public.client_dispatch_requests;

-- 2) Borrar los lotes que la app creo desde cero (no existen en el programa).
--    Los de la empresa de prueba tienen solucion_mirror_id, asi que se salvan.
delete from public.lots l
using public.clients c
where c.id = l.client_id
  and l.solucion_mirror_id is null
  and c.solucion_codigo is distinct from 999;

-- 3) Restaurar el stock de TODOS los lotes del programa desde su historico.
--    Idempotente: los no tocados ya coinciden y quedan igual.
with ultimo as (
  select distinct on (product_code, warehouse_code, coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'))
         product_code || '-' || warehouse_code || '-' ||
         coalesce(nullif(lot,''),'SIN-LOTE') || '-' ||
         coalesce(expiry_date::text,'SINVEN')   as mirror_id,
         new_quantity
  from public.desktop_movements
  where warehouse_code is not null
  order by product_code, warehouse_code,
           coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'),
           date desc, id desc
)
update public.lots l
set current_quantity  = u.new_quantity * (case when l.package_unit in ('ml','gr') then 1000 else 1 end),
    entry_loose_units = u.new_quantity * (case when l.package_unit in ('ml','gr') then 1000 else 1 end),
    updated_at        = now()
from ultimo u
where l.solucion_mirror_id = u.mirror_id
  and l.current_quantity is distinct from
      u.new_quantity * (case when l.package_unit in ('ml','gr') then 1000 else 1 end);

-- 4) Volver a poner el candado
do $$
begin
  if exists (select 1 from pg_trigger
             where tgname = 'movements_prevent_delete'
               and tgrelid = 'public.movements'::regclass and not tgisinternal) then
    alter table public.movements enable trigger movements_prevent_delete;
  end if;
end $$;

commit;

-- ============================================================
-- VERIFICACION (correr cada una por separado para ver su resultado)
-- ============================================================

-- 1) No debe quedar NADA de la app; el historico intacto en 4.214
select
  (select count(*) from public.movements)                 as movimientos_app,
  (select count(*) from public.warehouse_operations)      as operaciones,
  (select count(*) from public.client_dispatch_requests)  as solicitudes,
  (select count(*) from public.desktop_movements)         as historico_programa;

-- 2) Totales esperados: 404 items · 1.117.073,55 lts · 742.080,30 kgs
select
  count(*) filter (where current_quantity > 0)            as items_con_stock,
  round(sum(case when package_unit in ('lt','ml')
       then current_quantity / (case when package_unit='ml' then 1000 else 1 end)
       else 0 end), 2)                                    as total_lts,
  round(sum(case when package_unit in ('kg','gr')
       then current_quantity / (case when package_unit='gr' then 1000 else 1 end)
       else 0 end), 2)                                    as total_kgs
from public.lots
where status = 'activo';

-- 3) CONTROL FUERTE: el saldo de CADA lote contra el historico del programa.
--    TIENE QUE VENIR VACIA.
with ultimo as (
  select distinct on (product_code, warehouse_code, coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'))
         product_code || '-' || warehouse_code || '-' ||
         coalesce(nullif(lot,''),'SIN-LOTE') || '-' ||
         coalesce(expiry_date::text,'SINVEN') as mirror_id,
         new_quantity
  from public.desktop_movements
  where warehouse_code is not null
  order by product_code, warehouse_code,
           coalesce(nullif(lot,''),'SIN-LOTE'), coalesce(expiry_date::text,'SINVEN'),
           date desc, id desc
)
select l.lot_code, l.product, l.current_quantity as en_la_app,
       u.new_quantity * (case when l.package_unit in ('ml','gr') then 1000 else 1 end) as segun_el_programa
from public.lots l
join ultimo u on u.mirror_id = l.solucion_mirror_id
where abs(l.current_quantity - u.new_quantity * (case when l.package_unit in ('ml','gr') then 1000 else 1 end)) > 0.01;
