-- ============================================================
-- 19b · QUITAR el bloqueo por vencimiento de las funciones que lo tienen
--
-- REGLA DE HAROLD: el vencimiento NUNCA bloquea una salida. Lo unico que
-- bloquea es que no haya stock suficiente. Motivo: a la empresa NO le conviene
-- que el cliente deje producto vencido en el deposito (riesgo con SENASAG),
-- asi que conviene que salga cuanto antes.
--
-- Segun el diagnostico 19a, quedaban bloqueando:
--   · register_movement   (movimientos desde la ficha del lote)
--   · approve_adjustment  (aprobar lo pendiente)
--
-- COMO LO HACE (importante): en el repo hay varias versiones de estas
-- funciones y no se puede saber cual quedo activa. Asi que este script LEE la
-- definicion VIVA de la base y le saca UNICAMENTE el bloque:
--
--     if ... expiry_date ... then
--       raise exception '... vencid ...';
--     end if;
--
-- Todo lo demas de la funcion queda intacto: no se reemplaza por ninguna
-- version del repo, se re-crea la misma que ya tenias, sin ese bloque.
-- ============================================================
begin;

do $patch$
declare
  r          record;
  definicion text;
  nueva      text;
  tocadas    int := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('register_movement', 'approve_adjustment',
                        'register_offline_movement', 'create_dispatch_operation',
                        'complete_client_dispatch_request')
  loop
    definicion := pg_get_functiondef(r.oid);

    -- Solo el if cuyo raise menciona "vencid": no toca ningun otro control
    nueva := regexp_replace(
      definicion,
      'if[^;]*expiry_date[^;]*then\s*raise\s+exception\s*''[^'']*vencid[^'']*''\s*;\s*end\s+if;',
      '',
      'gi'
    );

    if nueva is distinct from definicion then
      execute nueva;
      tocadas := tocadas + 1;
      raise notice 'Bloqueo por vencimiento quitado de: %', r.proname;
    end if;
  end loop;

  raise notice 'Funciones corregidas: %', tocadas;
end
$patch$;

commit;

-- ============================================================
-- VERIFICACION — todas tienen que decir "ok"
-- ============================================================
select
  p.proname                                 as funcion,
  case
    when pg_get_functiondef(p.oid) ilike '%vencid%' then 'TODAVIA BLOQUEA'
    else 'ok'
  end                                       as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'register_movement', 'register_offline_movement', 'approve_adjustment',
    'create_dispatch_operation', 'create_entry_operation',
    'complete_client_dispatch_request', 'start_client_dispatch_request'
  )
order by estado desc, p.proname;

-- Control: los otros bloqueos que SI deben seguir vivos (retenido/cerrado y
-- stock insuficiente). Estas dos tienen que seguir apareciendo.
select
  p.proname                                                            as funcion,
  pg_get_functiondef(p.oid) ilike '%retenido%'                         as frena_retenido_o_cerrado,
  (pg_get_functiondef(p.oid) ilike '%insuficiente%'
   or pg_get_functiondef(p.oid) ilike '%no hay stock%'
   or pg_get_functiondef(p.oid) ilike '%stock disponible%')            as frena_por_stock
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('register_movement', 'approve_adjustment', 'create_dispatch_operation')
order by p.proname;
