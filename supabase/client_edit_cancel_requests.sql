-- Permite al cliente MODIFICAR o CANCELAR sus solicitudes de despacho
-- mientras sigan pendientes (no en preparación, ni despachadas, ni rechazadas).
-- Correr UNA VEZ en Supabase SQL Editor.

-- 1. Nuevo estado 'cancelado'
alter table public.client_dispatch_requests
drop constraint if exists client_dispatch_requests_status_check;

alter table public.client_dispatch_requests
add constraint client_dispatch_requests_status_check
check (status in ('pendiente', 'aprobado', 'en_preparacion', 'rechazado', 'despachado', 'cancelado'));

-- 2. El cliente puede actualizar SOLO sus solicitudes y SOLO si siguen pendientes.
--    La fila resultante solo puede quedar 'pendiente' (edición) o 'cancelado' (cancelación).
drop policy if exists "Clientes editan sus solicitudes pendientes" on public.client_dispatch_requests;
create policy "Clientes editan sus solicitudes pendientes"
on public.client_dispatch_requests for update
to authenticated
using (
  status in ('pendiente', 'aprobado')
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'cliente'
      and p.client_id = client_dispatch_requests.client_id
  )
)
with check (
  status in ('pendiente', 'cancelado')
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'cliente'
      and p.client_id = client_dispatch_requests.client_id
  )
);
