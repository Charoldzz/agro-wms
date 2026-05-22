do $$
begin
  if exists (select 1 from pg_type where typname = 'user_role')
     and not exists (
       select 1
       from pg_enum e
       join pg_type t on t.oid = e.enumtypid
       where t.typname = 'user_role'
         and e.enumlabel = 'cliente'
     ) then
    alter type public.user_role add value 'cliente';
  end if;
end $$;

alter table public.profiles
add column if not exists client_id uuid references public.clients(id);

create table if not exists public.client_dispatch_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  lot_id uuid references public.lots(id),
  product text,
  quantity numeric(12, 2) not null check (quantity > 0),
  items jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'aprobado' check (status in ('pendiente', 'aprobado', 'rechazado', 'despachado')),
  admin_notes text,
  requested_by uuid not null constraint client_dispatch_requests_requested_by_fkey references public.profiles(id),
  reviewed_by uuid constraint client_dispatch_requests_reviewed_by_fkey references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists client_dispatch_requests_client_id_idx
on public.client_dispatch_requests(client_id, created_at desc);

create index if not exists client_dispatch_requests_status_idx
on public.client_dispatch_requests(status, created_at desc);

alter table public.client_dispatch_requests enable row level security;

drop policy if exists "Clientes ven sus solicitudes" on public.client_dispatch_requests;
drop policy if exists "Clientes crean solicitudes propias" on public.client_dispatch_requests;
drop policy if exists "Administradores ven solicitudes" on public.client_dispatch_requests;
drop policy if exists "Administradores revisan solicitudes" on public.client_dispatch_requests;
drop policy if exists "Operadores ven solicitudes aprobadas" on public.client_dispatch_requests;

create policy "Clientes ven sus solicitudes"
on public.client_dispatch_requests for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'cliente'
      and p.client_id = client_dispatch_requests.client_id
  )
);

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

create policy "Administradores ven solicitudes"
on public.client_dispatch_requests for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
);

create policy "Operadores ven solicitudes aprobadas"
on public.client_dispatch_requests for select
to authenticated
using (
  status = 'aprobado'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'operador'
  )
);

create policy "Administradores revisan solicitudes"
on public.client_dispatch_requests for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'administrador'
  )
);

alter table public.client_dispatch_requests
drop constraint if exists client_dispatch_requests_status_check;

alter table public.client_dispatch_requests
add constraint client_dispatch_requests_status_check
check (status in ('pendiente', 'aprobado', 'rechazado', 'despachado'));

alter table public.client_dispatch_requests
add column if not exists items jsonb not null default '[]'::jsonb;

alter table public.client_dispatch_requests
alter column status set default 'aprobado';

update public.client_dispatch_requests
set status = 'aprobado'
where status = 'pendiente';

create or replace function public.complete_client_dispatch_request(
  p_request_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario no coincide con la sesion activa.';
  end if;

  select role::text into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para cerrar solicitudes.';
  end if;

  update public.client_dispatch_requests
  set
    status = 'despachado',
    reviewed_by = p_user_id,
    reviewed_at = now()
  where id = p_request_id
    and status = 'aprobado';
end;
$$;
