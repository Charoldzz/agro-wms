-- ============================================================
-- CORREO PERIÓDICO DE INVENTARIO — programador (pg_cron)
--
-- Corre TODOS LOS DÍAS y llama a la edge function send-inventory-emails, que
-- por dentro decide a qué empresas les toca hoy (según su frecuencia y la
-- fecha del último envío). O sea: el cron es diario, pero cada empresa recibe
-- según SU frecuencia (mensual/quincenal/semanal).
--
-- ⚠️ ANTES de correr esto:
--   1. Corré primero  inventario_periodico_config.sql  (agrega los campos).
--   2. Desplegá la edge function  send-inventory-emails.
--   3. Reemplazá  PEGA_TU_ANON_KEY  por tu clave anónima:
--        Supabase → Settings → API → Project API keys → "anon public".
--      (La anon key es pública, no es secreta — sirve para pasar el portón.)
--
-- Horario: 13:00 UTC = 09:00 en Bolivia (mañana). Cambiá el '0 13 * * *' si querés otro.
-- Idempotente: si ya existe el job con ese nombre, lo reemplaza.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'inventory-emails-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url := 'https://cwchkcdeexeedxoycela.supabase.co/functions/v1/send-inventory-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer PEGA_TU_ANON_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Ver el job programado:
--   select jobname, schedule, active from cron.job where jobname = 'inventory-emails-daily';
-- Para APAGARLO en cualquier momento:
--   select cron.unschedule('inventory-emails-daily');
