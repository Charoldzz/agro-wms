-- ============================================================
-- CREAR USUARIOS DESDE SUPABASE — guia rapida (2026-07-13)
-- ============================================================
-- Flujo cada vez que necesites un usuario nuevo:
--   1. Supabase -> Authentication -> Users -> "Add user" -> "Create new user"
--      (poner correo y contrasena; dejar marcado "Auto Confirm User")
--   2. Pegar en el SQL Editor el bloque A (operador) o B (cliente),
--      editar las 2 lineas marcadas con <<< y correr.
--   3. Listo: esa persona ya entra y ve lo que le corresponde.
--
-- La PARTE 1 se corre UNA SOLA VEZ (si ya corriste invitaciones_usuarios.sql
-- o usuarios_portal_cliente.sql, ya esta hecha — no hace falta repetirla).

-- ============================================================
-- PARTE 1 (una sola vez): usuario nuevo nace como cliente SIN empresa
-- (no ve nada hasta que le asignes algo con el bloque A o B — es lo seguro;
-- antes nacian como operador y veian todo el almacen)
-- ============================================================
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

-- ============================================================
-- BLOQUE A — el usuario nuevo es un OPERADOR
-- ============================================================
/*
UPDATE public.profiles p
SET role = 'operador', full_name = 'NOMBRE DEL OPERADOR', client_id = null   -- <<< nombre
FROM auth.users u
WHERE u.id = p.id
  AND u.email = 'correo@delusuario.com';                                     -- <<< correo
*/

-- ============================================================
-- BLOQUE B — el usuario nuevo es un CLIENTE (portal de su empresa)
-- OJO: el nombre tiene que matchear UNA sola empresa. Si hay dudas
-- (ej. hay DOS Tecnomyl), primero mira los nombres exactos con:
--   SELECT name FROM public.clients WHERE inventory_source = 'stock_independiente' ORDER BY name;
-- ============================================================
/*
UPDATE public.profiles p
SET role      = 'cliente',
    full_name = c.name,
    client_id = c.id
FROM auth.users u,
     public.clients c
WHERE u.id = p.id
  AND u.email = 'correo@delusuario.com'                                      -- <<< correo
  AND c.name ILIKE '%NOMBRE DE LA EMPRESA%'                                  -- <<< empresa (parte del nombre alcanza)
  AND c.inventory_source = 'stock_independiente';
*/

-- ============================================================
-- VERIFICACION — ver todos los usuarios y que tienen asignado
-- ============================================================
SELECT u.email, p.full_name, p.role, c.name AS empresa
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
LEFT JOIN public.clients c ON c.id = p.client_id
ORDER BY u.created_at DESC;
