-- Limpieza para operar solo con datos vigentes importados desde Solucion.
-- Ejecuta este archivo despues de importar el espejo de Solucion y aplicar
-- supabase/apply_solucion_inventory_to_app.sql.

begin;

alter table public.clients
  add column if not exists solucion_codigo bigint;

alter table public.lots
  add column if not exists inventory_source text not null default 'app';

-- Todo lote que no venga de Solucion deja de estar disponible para operar.
update public.lots
set
  inventory_source = 'legacy',
  current_quantity = 0,
  status = 'cerrado',
  updated_at = now()
where coalesce(inventory_source, 'app') <> 'solucion';

-- Las solicitudes abiertas antiguas pueden apuntar a clientes/lotes viejos.
-- Se cierran para que el operador solo trabaje con solicitudes nuevas de Solucion.
update public.client_dispatch_requests request
set
  status = 'rechazado',
  admin_notes = trim(concat(coalesce(admin_notes, ''), ' Cerrada por migracion a datos de Solucion.')),
  reviewed_at = coalesce(reviewed_at, now())
where status in ('pendiente', 'aprobado', 'en_preparacion', 'recibido')
  and (
    request.client_id is null
    or not exists (
      select 1
      from public.clients client
      where client.id = request.client_id
        and client.solucion_codigo is not null
    )
    or (
      request.lot_id is not null
      and not exists (
        select 1
        from public.lots lot
        where lot.id = request.lot_id
          and lot.inventory_source = 'solucion'
      )
    )
  );

-- Relaciona usuarios cliente con el cliente de Solucion por nombre normalizado.
with profile_names as (
  select
    profile.id,
    upper(regexp_replace(translate(coalesce(profile.full_name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ"', 'AEIOUUNaeiouun '), '\s+', ' ', 'g')) as normalized_name
  from public.profiles profile
  where profile.role = 'cliente'
),
solucion_clients as (
  select
    client.id,
    upper(regexp_replace(translate(coalesce(client.name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ"', 'AEIOUUNaeiouun '), '\s+', ' ', 'g')) as normalized_name
  from public.clients client
  where client.solucion_codigo is not null
),
matches as (
  select distinct on (profile_names.id)
    profile_names.id as profile_id,
    solucion_clients.id as client_id
  from profile_names
  join solucion_clients on solucion_clients.normalized_name = profile_names.normalized_name
  order by profile_names.id, solucion_clients.id
)
update public.profiles profile
set client_id = matches.client_id
from matches
where profile.id = matches.profile_id
  and profile.client_id is distinct from matches.client_id;

-- Borra clientes viejos que ya no estan referenciados por auditoria ni operaciones.
delete from public.clients client
where client.solucion_codigo is null
  and not exists (select 1 from public.lots lot where lot.client_id = client.id)
  and not exists (select 1 from public.profiles profile where profile.client_id = client.id)
  and not exists (select 1 from public.client_dispatch_requests request where request.client_id = client.id)
  and not exists (select 1 from public.warehouse_operations operation where operation.client_id = client.id);

commit;

select
  (select count(*) from public.clients where solucion_codigo is not null) as clientes_solucion,
  (select count(*) from public.clients where solucion_codigo is null) as clientes_legacy_restantes,
  (select count(*) from public.lots where inventory_source = 'solucion' and current_quantity > 0) as lotes_solucion_activos,
  (select count(*) from public.lots where inventory_source <> 'solucion') as lotes_legacy_cerrados,
  (select count(*) from public.client_dispatch_requests where status in ('pendiente', 'aprobado', 'en_preparacion', 'recibido')) as solicitudes_abiertas;
