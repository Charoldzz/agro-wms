-- ============================================================
-- ACCESO AL PORTAL POR EMPRESA — funciones para el admin
--
-- Permite invitar/ver/revocar los usuarios que entran al portal de cada
-- empresa cliente. La INVITACION la hace la edge function `invite-user`
-- (ya existe); estas dos funciones son para LISTAR y REVOCAR.
--
-- Ambas son SECURITY DEFINER y verifican que quien llama sea administrador.
-- ============================================================

-- 1) LISTAR los usuarios de una empresa, con su correo y estado.
--    profiles no guarda el correo → hay que leerlo de auth.users.
create or replace function public.company_portal_users(p_client_id uuid)
returns table (
  user_id       uuid,
  email         text,
  full_name     text,
  estado        text,          -- 'activo' | 'invitado'
  last_sign_in  timestamptz,
  created_at    timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- Solo el administrador puede ver los usuarios de una empresa
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'administrador'
  ) then
    raise exception 'Solo el administrador puede ver los usuarios.';
  end if;

  return query
  select
    u.id,
    u.email::text,
    p.full_name,
    case when u.last_sign_in_at is not null or u.email_confirmed_at is not null
         then 'activo' else 'invitado' end,
    u.last_sign_in_at,
    u.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.client_id = p_client_id
    and p.role::text = 'cliente'
  order by u.created_at;
end;
$$;

grant execute on function public.company_portal_users(uuid) to authenticated;


-- 2) REVOCAR el acceso de un usuario (lo borra por completo).
--    Al borrar de auth.users, el perfil se va solo (ON DELETE CASCADE).
create or replace function public.revoke_portal_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role text;
begin
  -- Solo el administrador puede revocar
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'administrador'
  ) then
    raise exception 'Solo el administrador puede quitar accesos.';
  end if;

  -- No permitir revocarse a si mismo
  if p_user_id = auth.uid() then
    raise exception 'No podes quitarte el acceso a vos mismo.';
  end if;

  -- Seguridad: SOLO se puede revocar usuarios cliente (nunca admins/operadores)
  select p.role::text into v_role from public.profiles p where p.id = p_user_id;
  if v_role is distinct from 'cliente' then
    raise exception 'Solo se puede quitar acceso a usuarios de portal cliente.';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.revoke_portal_user(uuid) to authenticated;


-- ============================================================
-- VERIFICACION rapida (opcional): usuarios del cliente de prueba (999)
-- ============================================================
-- select * from public.company_portal_users(
--   (select id from public.clients where solucion_codigo = 999)
-- );


-- ============================================================
-- 3) CONTEO de usuarios por empresa (para los chips de la lista).
--    Devuelve, por cada empresa con usuarios cliente, cuantos activos y
--    cuantos con invitacion pendiente. Solo el administrador.
-- ============================================================
create or replace function public.company_portal_user_counts()
returns table (
  client_id   uuid,
  activos     int,
  pendientes  int
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'administrador'
  ) then
    raise exception 'Solo el administrador puede ver los usuarios.';
  end if;

  return query
  select
    p.client_id,
    count(*) filter (where u.last_sign_in_at is not null or u.email_confirmed_at is not null)::int,
    count(*) filter (where u.last_sign_in_at is null and u.email_confirmed_at is null)::int
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role::text = 'cliente' and p.client_id is not null
  group by p.client_id;
end;
$$;

grant execute on function public.company_portal_user_counts() to authenticated;
