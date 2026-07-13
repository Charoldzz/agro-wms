-- Invitaciones de usuarios (2026-07-13) — reemplaza el trigger de usuarios nuevos.
-- Flujo: el admin invita desde la app (pantalla Clientes) → la edge function
-- invite-user crea el usuario con su rol y empresa en metadata → este trigger
-- arma el perfil → el invitado recibe el correo, crea su contraseña y entra
-- directo a su portal (cliente) o al almacen (operador).
-- Seguridad: del metadata solo se aceptan roles 'cliente' u 'operador'
-- (administrador JAMAS); un usuario creado sin metadata nace como cliente
-- sin empresa (no ve nada hasta que se le asigne algo por SQL).
-- Correr UNA VEZ en Supabase SQL Editor.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(coalesce(new.raw_user_meta_data->>'role', ''));
begin
  insert into public.profiles (id, full_name, role, client_id)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    case when v_role = 'operador' then 'operador'::user_role else 'cliente'::user_role end,
    nullif(new.raw_user_meta_data->>'client_id', '')::uuid
  );
  return new;
end;
$$;

-- Verificacion: el trigger sigue conectado a auth.users
select tgname, tgenabled from pg_trigger where tgname = 'on_auth_user_created';
