-- Fichas de producto creadas por operadores quedan "pendientes de revisión" (2026-07-10)
-- Correr UNA VEZ en Supabase SQL Editor.

-- 1. Marca de revisión
alter table public.product_catalog
add column if not exists pending_review boolean not null default false;

-- 2. Los operadores pueden CREAR fichas (solo marcadas como pendientes).
--    Editar/eliminar sigue siendo exclusivo del administrador.
drop policy if exists "Operadores crean fichas pendientes" on public.product_catalog;
create policy "Operadores crean fichas pendientes"
on public.product_catalog for insert
to authenticated
with check (
  pending_review = true
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role::text = 'operador'
  )
);
