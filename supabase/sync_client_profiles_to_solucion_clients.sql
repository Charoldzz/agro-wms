-- Re-vincula usuarios cliente con los clientes actuales sincronizados desde Solucion.
-- Usalo despues de ejecutar apply_solucion_inventory_to_app.sql.
--
-- Por que hace falta:
-- Si un usuario cliente estaba asignado a un cliente viejo/legacy, el portal no
-- puede ver los lotes nuevos de Solucion aunque el nombre del cliente sea igual.

with normalized_clients as (
  select
    id,
    name,
    solucion_codigo,
    regexp_replace(upper(trim(name)), '[^A-Z0-9]+', '', 'g') as normalized_name
  from public.clients
),
current_profile_clients as (
  select
    p.id as profile_id,
    p.full_name,
    p.client_id as current_client_id,
    old_client.name as current_client_name,
    regexp_replace(upper(trim(coalesce(old_client.name, p.full_name))), '[^A-Z0-9]+', '', 'g') as lookup_name
  from public.profiles p
  left join public.clients old_client on old_client.id = p.client_id
  where p.role::text = 'cliente'
),
solucion_matches as (
  select distinct on (p.profile_id)
    p.profile_id,
    p.full_name,
    p.current_client_id,
    p.current_client_name,
    c.id as solucion_client_id,
    c.name as solucion_client_name
  from current_profile_clients p
  join normalized_clients c
    on c.normalized_name = p.lookup_name
   and c.solucion_codigo is not null
  order by p.profile_id, case when c.solucion_codigo < 0 then 0 else 1 end, c.name
),
updated as (
  update public.profiles p
  set client_id = m.solucion_client_id
  from solucion_matches m
  where p.id = m.profile_id
    and (p.client_id is distinct from m.solucion_client_id)
  returning
    p.id,
    p.full_name,
    m.current_client_name as cliente_anterior,
    m.solucion_client_name as cliente_actual
)
select
  (select count(*) from updated) as perfiles_cliente_actualizados,
  (select count(*) from public.profiles where role::text = 'cliente' and client_id is not null) as perfiles_cliente_con_cliente,
  (select count(*) from public.profiles p where p.role::text = 'cliente' and exists (
    select 1
    from public.lots l
    where l.client_id = p.client_id
      and l.inventory_source = 'solucion'
      and l.status = 'activo'
      and l.current_quantity > 0
  )) as perfiles_cliente_con_stock_visible;

