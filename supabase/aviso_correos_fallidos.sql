-- ═══════════════════════════════════════════════════════════════════════
--  AVISAR CUANDO UN CORREO NO LLEGA
-- ═══════════════════════════════════════════════════════════════════════
-- Hoy, si un correo al cliente falla, el error se tira a la basura: en el
-- código del ingreso y de la salida está escrito literalmente `.catch(() => {})`.
-- El operador ve "guardado", el cliente nunca se entera de que llegó su
-- mercadería, y nadie se entera nunca de que el aviso no salió.
--
-- Esto NO es una bandeja de correos: no se guarda lo que sale bien. Se guarda
-- solamente lo que FALLA, para poder avisarlo en la franja naranja de inicio,
-- igual que los descuadres. Si no falla nada, no se ve nada.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.email_failures (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  -- 'movimiento' (aviso de ingreso/salida) o 'inventario' (resumen periódico)
  tipo          text not null,
  client_id     uuid references public.clients(id) on delete set null,
  client_name   text,
  destinatarios text[],
  guia          text,              -- ING-00227 / SAL-01465, si corresponde
  motivo        text,              -- qué dijo el servidor de correo
  resuelto      boolean not null default false,
  resuelto_at   timestamptz,
  resuelto_by   uuid references auth.users(id) on delete set null
);

comment on table public.email_failures is
  'Correos al cliente que no salieron. Solo fallas: no es un historial de envíos.';

create index if not exists email_failures_pendientes_idx
  on public.email_failures (resuelto, created_at desc);

alter table public.email_failures enable row level security;

-- Solo el administrador y el operador lo ven. El cliente no tiene por qué
-- enterarse de que un aviso suyo falló: eso lo resuelve el depósito.
drop policy if exists "Depósito ve los correos fallidos" on public.email_failures;
create policy "Depósito ve los correos fallidos"
on public.email_failures for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('administrador', 'operador')
  )
);

-- La app anota la falla cuando ni siquiera puede llamar a la función de correo
drop policy if exists "Depósito anota un correo fallido" on public.email_failures;
create policy "Depósito anota un correo fallido"
on public.email_failures for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('administrador', 'operador')
  )
);

-- Marcar "ya lo resolví" (se avisó al cliente por otro lado, o se corrigió
-- la dirección). No se borra: queda el rastro.
drop policy if exists "Depósito marca resuelto un correo fallido" on public.email_failures;
create policy "Depósito marca resuelto un correo fallido"
on public.email_failures for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('administrador', 'operador')
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('administrador', 'operador')
  )
);


-- ── Marcar uno como resuelto ───────────────────────────────────────────
create or replace function public.resolver_correo_fallido(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_rol text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select p.role::text into v_rol
  from public.profiles p
  where p.id = auth.uid();

  if v_rol is distinct from 'administrador' and v_rol is distinct from 'operador' then
    raise exception 'Solo el administrador o el operador pueden marcarlo.';
  end if;

  update public.email_failures
  set resuelto = true, resuelto_at = now(), resuelto_by = auth.uid()
  where id = p_id;
end;
$$;

revoke all on function public.resolver_correo_fallido(bigint) from public;
grant execute on function public.resolver_correo_fallido(bigint) to authenticated;
