-- Solicitudes del portal cliente entran directo al tablero del operario.
alter table public.client_dispatch_requests
alter column status set default 'aprobado';

update public.client_dispatch_requests
set status = 'aprobado'
where status = 'pendiente';

drop policy if exists "Clientes crean solicitudes propias" on public.client_dispatch_requests;

create policy "Clientes crean solicitudes propias"
on public.client_dispatch_requests for insert
to authenticated
with check (
  requested_by = auth.uid()
  and status = 'aprobado'
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
