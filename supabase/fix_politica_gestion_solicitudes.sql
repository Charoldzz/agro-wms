-- Recrea la política de gestión de solicitudes para admin + operador (2026-07-16)
-- El rechazo fallaba: la política existente quedó incompleta de un intento previo.
-- Este DROP + CREATE garantiza la definición correcta (using Y with check).
-- Correr UNA VEZ en Supabase SQL Editor.

drop policy if exists "Administradores revisan solicitudes" on public.client_dispatch_requests;
drop policy if exists "Equipo gestiona solicitudes" on public.client_dispatch_requests;

create policy "Equipo gestiona solicitudes"
on public.client_dispatch_requests for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text in ('administrador', 'operador')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text in ('administrador', 'operador')
  )
);

-- Verificación: debe listar la política con cmd = UPDATE
select policyname, cmd, roles
from pg_policies
where tablename = 'client_dispatch_requests' and policyname = 'Equipo gestiona solicitudes';
