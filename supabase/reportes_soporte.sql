-- ============================================================
-- REPORTES DE SOPORTE DEL PORTAL (bugs / errores / mejoras)
--
-- El cliente envía un reporte desde el portal; se guarda con contexto
-- automático (empresa, usuario, versión de app, pantalla, dispositivo).
-- El admin los ve/gestiona desde Almacenes → Reportes.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

create table if not exists public.portal_feedback (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  reporter_id    uuid references auth.users(id) on delete set null,
  client_id      uuid references public.clients(id) on delete set null,
  reporter_email text,
  reporter_name  text,
  client_name    text,
  tipo           text not null check (tipo in ('bug','error','mejora')),
  mensaje        text not null,
  app_version    text,
  page           text,
  user_agent     text,
  status         text not null default 'nuevo' check (status in ('nuevo','visto','resuelto')),
  admin_notes    text,
  resolved_at    timestamptz
);

create index if not exists portal_feedback_status_idx
  on public.portal_feedback (status, created_at desc);

-- ── Envío del reporte ───────────────────────────────────────
-- SECURITY DEFINER: estampa empresa/usuario del que llama, así el cliente
-- NO puede falsificar de qué empresa es ni a nombre de quién reporta.
create or replace function public.submit_portal_feedback(
  p_tipo        text,
  p_mensaje     text,
  p_page        text,
  p_app_version text,
  p_user_agent  text
) returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_client_id uuid;
  v_name      text;
  v_email     text;
  v_id        uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para enviar un reporte.';
  end if;
  if p_tipo not in ('bug','error','mejora') then
    raise exception 'Tipo de reporte inválido.';
  end if;
  if coalesce(btrim(p_mensaje), '') = '' then
    raise exception 'El mensaje no puede estar vacío.';
  end if;

  select p.client_id, p.full_name into v_client_id, v_name
  from public.profiles p where p.id = auth.uid();
  select u.email::text into v_email from auth.users u where u.id = auth.uid();

  insert into public.portal_feedback
    (reporter_id, client_id, reporter_email, reporter_name, client_name,
     tipo, mensaje, app_version, page, user_agent)
  values
    (auth.uid(), v_client_id, v_email, v_name,
     (select c.name from public.clients c where c.id = v_client_id),
     p_tipo, left(btrim(p_mensaje), 4000), nullif(p_app_version, ''),
     nullif(p_page, ''), left(coalesce(p_user_agent, ''), 600))
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_portal_feedback(text, text, text, text, text) to authenticated;

-- ── Permisos de lectura/gestión: SOLO el administrador ──────
-- (El INSERT va únicamente por la función de arriba, que es SECURITY DEFINER;
--  por eso no hace falta una política de insert.)
alter table public.portal_feedback enable row level security;

drop policy if exists portal_feedback_admin_select on public.portal_feedback;
create policy portal_feedback_admin_select on public.portal_feedback
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role::text = 'administrador'));

drop policy if exists portal_feedback_admin_update on public.portal_feedback;
create policy portal_feedback_admin_update on public.portal_feedback
  for update to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role::text = 'administrador'))
  with check (exists (select 1 from public.profiles p
                      where p.id = auth.uid() and p.role::text = 'administrador'));

drop policy if exists portal_feedback_admin_delete on public.portal_feedback;
create policy portal_feedback_admin_delete on public.portal_feedback
  for delete to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role::text = 'administrador'));

-- ── VERIFICACIÓN opcional ───────────────────────────────────
-- select * from public.portal_feedback order by created_at desc;
