-- ============================================================
-- CORREO PERIÓDICO DE INVENTARIO — configuración por empresa
--
-- Agrega a cada empresa (clients) la frecuencia del correo de inventario y la
-- fecha del último envío. Frecuencia por defecto: mensual.
--   frecuencia: 'mensual' | 'quincenal' | 'semanal' | 'ninguno'
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

alter table public.clients
  add column if not exists inventory_email_frequency text not null default 'mensual',
  add column if not exists inventory_email_last_sent timestamptz;

-- Restricción de valores válidos (idempotente)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_inventory_email_frequency_chk'
  ) then
    alter table public.clients
      add constraint clients_inventory_email_frequency_chk
      check (inventory_email_frequency in ('mensual','quincenal','semanal','ninguno'));
  end if;
end $$;

-- VERIFICACIÓN opcional:
-- select name, inventory_email_frequency, inventory_email_last_sent from public.clients order by name;
