create extension if not exists "pgcrypto";

alter type public.user_role add value if not exists 'cliente';

alter table public.profiles
add column if not exists client_id uuid references public.clients(id);

alter table public.lots
add column if not exists qr_token text;

update public.lots
set qr_token = encode(gen_random_bytes(24), 'hex')
where qr_token is null or trim(qr_token) = '';

alter table public.lots
alter column qr_token set default encode(gen_random_bytes(24), 'hex');

create unique index if not exists lots_qr_token_key on public.lots(qr_token);

create or replace function public.resolve_lot_qr(p_token text)
returns table(lot_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_client_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion.';
  end if;

  select role::text, client_id
  into v_role, v_client_id
  from public.profiles
  where id = auth.uid();

  if v_role in ('administrador', 'operador') then
    return query
    select l.id
    from public.lots l
    where l.qr_token = p_token
    limit 1;
    return;
  end if;

  if v_role = 'cliente' then
    return query
    select l.id
    from public.lots l
    where l.qr_token = p_token
      and l.client_id = v_client_id
    limit 1;
    return;
  end if;

  return;
end;
$$;

grant execute on function public.resolve_lot_qr(text) to authenticated;

drop policy if exists "Usuarios autenticados leen clientes" on public.clients;
drop policy if exists "Usuarios leen clientes autorizados" on public.clients;
drop policy if exists "Administradores gestionan clientes" on public.clients;
drop policy if exists "Usuarios autenticados leen lotes" on public.lots;
drop policy if exists "Usuarios leen lotes autorizados" on public.lots;
drop policy if exists "Administradores crean lotes" on public.lots;
drop policy if exists "Administradores actualizan lotes" on public.lots;
drop policy if exists "Usuarios autenticados leen movimientos" on public.movements;
drop policy if exists "Usuarios leen movimientos autorizados" on public.movements;

create policy "Usuarios leen clientes autorizados"
on public.clients for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role::text in ('administrador', 'operador')
        or p.client_id = clients.id
      )
  )
);

create policy "Administradores gestionan clientes"
on public.clients for all
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'administrador'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'administrador'));

create policy "Usuarios leen lotes autorizados"
on public.lots for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        p.role::text in ('administrador', 'operador')
        or p.client_id = lots.client_id
      )
  )
);

create policy "Administradores crean lotes"
on public.lots for insert
to authenticated
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'administrador'));

create policy "Administradores actualizan lotes"
on public.lots for update
to authenticated
using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'administrador'))
with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role::text = 'administrador'));

create policy "Usuarios leen movimientos autorizados"
on public.movements for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    join public.lots l on l.id = movements.lot_id
    where p.id = auth.uid()
      and (
        p.role::text in ('administrador', 'operador')
        or p.client_id = l.client_id
      )
  )
);
