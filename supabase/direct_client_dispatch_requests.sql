-- Solicitudes del portal cliente entran directo al tablero del operario como despacho pendiente.
alter table public.client_dispatch_requests
alter column status set default 'pendiente';

drop policy if exists "Clientes crean solicitudes propias" on public.client_dispatch_requests;

create policy "Clientes crean solicitudes propias"
on public.client_dispatch_requests for insert
to authenticated
with check (
  requested_by = auth.uid()
  and status = 'pendiente'
  and reviewed_by is null
  and reviewed_at is null
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'cliente'
      and p.client_id = client_dispatch_requests.client_id
  )
);
