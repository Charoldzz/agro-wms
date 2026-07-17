-- Función para rechazar una solicitud, con permisos controlados (2026-07-16)
-- El UPDATE directo del operador chocaba con el WITH CHECK de las políticas
-- superpuestas (la fila en 'en_preparacion' no podía pasar a 'rechazado').
-- Esta función corre como SECURITY DEFINER: valida el rol y hace el cambio
-- saltándose el laberinto de RLS, de forma segura.
-- Correr UNA VEZ en Supabase SQL Editor.

create or replace function public.reject_dispatch_request(
  p_request_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para rechazar solicitudes.';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'El motivo del rechazo es obligatorio.';
  end if;

  update public.client_dispatch_requests
  set status = 'rechazado',
      admin_notes = trim(p_reason),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_request_id
    and status in ('pendiente', 'aprobado', 'en_preparacion');

  if not found then
    raise exception 'La solicitud no existe o ya fue procesada.';
  end if;
end;
$$;

grant execute on function public.reject_dispatch_request(uuid, text) to authenticated;

-- Función para marcar una solicitud "en preparación" al abrir el despacho
-- (mismo motivo: evitar el laberinto de RLS en el UPDATE directo)
create or replace function public.mark_dispatch_in_progress(
  p_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso.';
  end if;

  update public.client_dispatch_requests
  set status = 'en_preparacion'
  where id = p_request_id
    and status in ('pendiente', 'aprobado');
end;
$$;

grant execute on function public.mark_dispatch_in_progress(uuid) to authenticated;
