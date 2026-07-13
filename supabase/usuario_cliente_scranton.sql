-- Convertir el usuario nuevo "stock" en portal de cliente de SCRANTON (2026-07-13)
-- Por que: todo usuario creado en Supabase Authentication nace como OPERADOR
-- (trigger handle_new_user, rol por defecto). Para que vea el portal de cliente
-- hay que darle rol 'cliente' + su empresa (client_id).
-- Correr UNA VEZ en Supabase SQL Editor.

-- ============================================================
-- PASO 0 — EDITAR ESTA LINEA: poner el correo EXACTO del usuario que creaste
-- ============================================================
-- (si no lo recordas, corre solo el SELECT de abajo para ver los usuarios)
-- SELECT u.email, p.full_name, p.role FROM auth.users u JOIN public.profiles p ON p.id = u.id ORDER BY u.created_at DESC;

UPDATE public.profiles p
SET role      = 'cliente',
    full_name = 'SCRANTON PAPER COMPANY',
    client_id = (SELECT id FROM public.clients WHERE name ILIKE '%SCRANTON%' LIMIT 1)
FROM auth.users u
WHERE u.id = p.id
  AND u.email = 'CORREO_DEL_USUARIO_AQUI';   -- <<< EDITAR: el correo con el que creaste al usuario

-- ============================================================
-- Verificacion: debe mostrar role = cliente y la empresa SCRANTON
-- ============================================================
SELECT u.email, p.full_name, p.role, c.name AS empresa
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
LEFT JOIN public.clients c ON c.id = p.client_id
WHERE p.role = 'cliente'
ORDER BY u.created_at DESC;
