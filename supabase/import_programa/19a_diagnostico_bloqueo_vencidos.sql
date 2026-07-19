-- ============================================================
-- 19a · DIAGNOSTICO: que funciones VIVAS todavia bloquean por vencimiento
--
-- REGLA DE HAROLD: el vencimiento NUNCA bloquea una salida. Lo unico que
-- bloquea es que no haya stock suficiente. Motivo: a la empresa NO le conviene
-- que el cliente deje producto vencido en el deposito (riesgo con SENASAG),
-- asi que conviene que salga.
--
-- En el repo hay varias versiones de estas funciones y no se puede saber por
-- los archivos cual quedo activa. Esta consulta lo pregunta a la base.
-- Solo LEE, no cambia nada.
-- ============================================================

select
  p.proname                                        as funcion,
  pg_get_function_identity_arguments(p.oid)        as argumentos,
  case
    when pg_get_functiondef(p.oid) ilike '%vencid%' then 'BLOQUEA POR VENCIMIENTO'
    else 'ok'
  end                                              as estado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'register_movement',
    'register_offline_movement',
    'approve_adjustment',
    'create_dispatch_operation',
    'create_entry_operation',
    'complete_client_dispatch_request',
    'start_client_dispatch_request'
  )
order by estado desc, p.proname;
