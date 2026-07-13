-- Usuarios de portal creados desde la app (2026-07-13)
-- Cambia el trigger que crea el perfil de cada usuario nuevo:
--   ANTES: todo usuario nuevo nacia como OPERADOR (riesgo: veia todo el almacen)
--   AHORA: todo usuario nuevo nace como CLIENTE, y si viene creado desde la
--          pantalla Clientes de la app, ya trae su empresa (client_id) y el
--          nombre de la empresa como nombre visible -> entra directo al portal.
-- Un usuario creado a mano en Supabase (sin empresa) nace como cliente SIN
-- empresa: no ve nada hasta que se le asigne rol/empresa por SQL (seguro).
-- Correr UNA VEZ en Supabase SQL Editor.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, client_id)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    'cliente',
    nullif(new.raw_user_meta_data->>'client_id', '')::uuid
  );
  return new;
end;
$$;

-- ============================================================
-- REFERENCIA (no correr ahora): para crear un OPERADOR nuevo en el futuro,
-- primero crear el usuario en Authentication -> Users y despues correr:
--
-- UPDATE public.profiles p
-- SET role = 'operador', full_name = 'NOMBRE DEL OPERADOR', client_id = null
-- FROM auth.users u
-- WHERE u.id = p.id AND u.email = 'correo_del_operador@aqui';
-- ============================================================

-- Verificacion: el trigger sigue conectado a auth.users
select tgname, tgenabled from pg_trigger where tgname = 'on_auth_user_created';
