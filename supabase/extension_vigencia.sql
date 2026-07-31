-- ============================================================
-- EXTENSIÓN DE VIGENCIA (revalidación de vencimiento)
--
-- Caso real: el fabricante revalida un producto y extiende su fecha de
-- vencimiento. NO es un movimiento de stock: no cambia la cantidad, ni el
-- dueño, ni la ubicación. Solo cambia la fecha del lote.
--
-- Reglas acordadas con Harold (2026-07-31):
--   · SOLO el ADMINISTRADOR puede extender una vigencia (es delicado
--     legalmente: se está extendiendo la vida de un agroquímico ajeno).
--   · Certificado del fabricante OBLIGATORIO.
--   · Motivo OBLIGATORIO.
--   · Queda el histórico completo: fecha anterior, nueva, motivo,
--     certificado, quién y cuándo. Nunca se pierde el dato original.
--
-- Se guarda en su propia tabla y NO en `movements` a propósito: el kardex
-- lleva cantidades, y esto no mueve cantidades. Mezclarlo ensuciaría los
-- reportes de stock.
--
-- Idempotente. Correr en Supabase → SQL Editor.
-- ============================================================

create table if not exists public.lot_expiry_extensions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  lot_id          uuid not null references public.lots(id) on delete cascade,
  client_id       uuid references public.clients(id) on delete set null,
  lot_code        text,
  product         text,
  previous_expiry date,
  new_expiry      date not null,
  reason          text not null,
  certificate_url text not null,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text
);

create index if not exists lot_expiry_extensions_lot_idx
  on public.lot_expiry_extensions (lot_id, created_at desc);

create index if not exists lot_expiry_extensions_client_idx
  on public.lot_expiry_extensions (client_id, created_at desc);

-- ── Aplicar la extensión ────────────────────────────────────
-- SECURITY DEFINER: valida el rol adentro, así nadie puede saltarse el
-- control tocando la tabla `lots` por su cuenta.
create or replace function public.extend_lot_expiry(
  p_lot_id          uuid,
  p_new_expiry      date,
  p_reason          text,
  p_certificate_url text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_role     text;
  v_name     text;
  v_lot      public.lots%rowtype;
  v_id       uuid;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión.';
  end if;

  select p.role::text, p.full_name into v_role, v_name
  from public.profiles p
  where p.id = auth.uid();

  -- Regla dura: solo administrador
  if coalesce(v_role, '') <> 'administrador' then
    raise exception 'Solo un administrador puede extender la vigencia de un lote.';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Indicá el motivo de la extensión de vigencia.';
  end if;

  if coalesce(btrim(p_certificate_url), '') = '' then
    raise exception 'Adjuntá el certificado del fabricante que respalda la extensión.';
  end if;

  if p_new_expiry is null then
    raise exception 'Indicá la nueva fecha de vencimiento.';
  end if;

  select * into v_lot
  from public.lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'Lote no encontrado.';
  end if;

  if v_lot.status = 'cerrado' then
    raise exception 'No se puede extender la vigencia de un lote cerrado.';
  end if;

  -- Solo se EXTIENDE: la fecha nueva tiene que ser posterior a la actual.
  if v_lot.expiry_date is not null and p_new_expiry <= v_lot.expiry_date then
    raise exception 'La nueva fecha (%) debe ser posterior a la vigencia actual (%).',
      to_char(p_new_expiry, 'DD/MM/YYYY'), to_char(v_lot.expiry_date, 'DD/MM/YYYY');
  end if;

  if p_new_expiry <= current_date then
    raise exception 'La nueva fecha de vencimiento debe ser posterior a hoy.';
  end if;

  -- Tope de cordura: evita un error de tipeo tipo año 2099
  if p_new_expiry > current_date + interval '10 years' then
    raise exception 'La nueva fecha no puede superar los 10 años. Revisá lo que cargaste.';
  end if;

  insert into public.lot_expiry_extensions (
    lot_id, client_id, lot_code, product,
    previous_expiry, new_expiry, reason, certificate_url,
    created_by, created_by_name
  ) values (
    v_lot.id, v_lot.client_id, v_lot.lot_code, v_lot.product,
    v_lot.expiry_date, p_new_expiry, btrim(p_reason), btrim(p_certificate_url),
    auth.uid(), v_name
  )
  returning id into v_id;

  update public.lots
  set expiry_date = p_new_expiry,
      updated_at  = now()
  where id = v_lot.id;

  return jsonb_build_object(
    'id',              v_id,
    'lot_id',          v_lot.id,
    'previous_expiry', v_lot.expiry_date,
    'new_expiry',      p_new_expiry
  );
end;
$$;

grant execute on function public.extend_lot_expiry(uuid, date, text, text) to authenticated;

-- ── Seguridad de la tabla ───────────────────────────────────
alter table public.lot_expiry_extensions enable row level security;

-- Admin y operador ven todo el histórico
drop policy if exists lot_expiry_ext_staff_select on public.lot_expiry_extensions;
create policy lot_expiry_ext_staff_select on public.lot_expiry_extensions
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role::text in ('administrador', 'operador')));

-- El cliente ve solo las extensiones de SUS lotes (transparencia)
drop policy if exists lot_expiry_ext_client_select on public.lot_expiry_extensions;
create policy lot_expiry_ext_client_select on public.lot_expiry_extensions
  for select to authenticated
  using (exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role::text = 'cliente'
                   and p.client_id = lot_expiry_extensions.client_id));

-- Nadie escribe directo: solo por la función (que valida el rol)
revoke insert, update, delete on public.lot_expiry_extensions from authenticated;

-- ── VERIFICACIÓN ────────────────────────────────────────────
-- select lot_code, product, previous_expiry, new_expiry, reason, created_by_name, created_at
--   from public.lot_expiry_extensions order by created_at desc;
