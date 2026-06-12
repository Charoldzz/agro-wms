-- Re-vincula usuarios cliente con los clientes oficiales importados desde Stock Independiente.
-- Usalo despues de importar stock_independiente y antes de probar el portal cliente.
--
-- Por que hace falta:
-- El portal cliente solo muestra lotes del client_id asignado al perfil.
-- Si el perfil quedo apuntando a un cliente viejo, el portal queda sin datos.

create or replace function public.stock_independent_client_key(value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    upper(replace(coalesce(value, ''), '"', '')),
    '[^A-Z0-9]+',
    '',
    'g'
  );
$$;

with profile_lookup as (
  select
    p.id as profile_id,
    p.full_name,
    p.client_id as current_client_id,
    old_client.name as current_client_name,
    public.stock_independent_client_key(coalesce(old_client.name, p.full_name)) as lookup_key
  from public.profiles p
  left join public.clients old_client on old_client.id = p.client_id
  where p.role::text = 'cliente'
),
stock_clients as (
  select
    c.id,
    c.name,
    public.stock_independent_client_key(c.name) as client_key
  from public.clients c
  where c.inventory_source = 'stock_independiente'
),
matches as (
  select
    p.profile_id,
    p.full_name,
    p.current_client_name,
    c.id as stock_client_id,
    c.name as stock_client_name,
    count(*) over (partition by p.profile_id) as match_count
  from profile_lookup p
  join stock_clients c on c.client_key = p.lookup_key
  where p.lookup_key <> ''
),
updated as (
  update public.profiles p
  set client_id = m.stock_client_id
  from matches m
  where p.id = m.profile_id
    and m.match_count = 1
    and p.client_id is distinct from m.stock_client_id
  returning
    p.id,
    p.full_name,
    m.current_client_name as cliente_anterior,
    m.stock_client_name as cliente_stock_independiente
)
select
  (select count(*) from updated) as perfiles_cliente_actualizados,
  (select count(*) from public.profiles where role::text = 'cliente' and client_id is not null) as perfiles_cliente_con_cliente,
  (select count(*) from public.profiles p where p.role::text = 'cliente' and exists (
    select 1
    from public.lots l
    where l.client_id = p.client_id
      and l.inventory_source = 'stock_independiente'
      and l.status = 'activo'
      and l.current_quantity > 0
  )) as perfiles_cliente_con_stock_visible;

-- Si algun usuario cliente sigue sin stock visible, revisa esta lista y asignalo manualmente.
select
  p.id as profile_id,
  p.full_name as usuario_cliente,
  c.name as cliente_asignado,
  c.inventory_source,
  count(l.id) filter (where l.inventory_source = 'stock_independiente' and l.status = 'activo' and l.current_quantity > 0) as lotes_visibles_stock_independiente
from public.profiles p
left join public.clients c on c.id = p.client_id
left join public.lots l on l.client_id = p.client_id
where p.role::text = 'cliente'
group by p.id, p.full_name, c.name, c.inventory_source
order by p.full_name;
