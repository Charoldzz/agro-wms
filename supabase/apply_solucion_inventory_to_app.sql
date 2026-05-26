-- Usa el espejo de Solucion como inventario principal de la app.
-- Ejecutar despues de:
-- 1) supabase/solucion_mirror.sql
-- 2) tmp/solucion_mirror/solucion_mirror_import.sql
--
-- Este script no borra auditoria ni movimientos. Archiva visualmente los lotes
-- anteriores y carga el stock positivo actual de Solucion en public.lots.

create extension if not exists "pgcrypto";

alter table public.clients
add column if not exists solucion_codigo bigint;

create unique index if not exists clients_solucion_codigo_key
on public.clients(solucion_codigo);

alter table public.lots
add column if not exists inventory_source text not null default 'app',
add column if not exists solucion_mirror_id text,
add column if not exists solucion_product_code text,
add column if not exists solucion_warehouse_code bigint,
add column if not exists solucion_synced_at timestamptz;

create unique index if not exists lots_solucion_mirror_id_key
on public.lots(solucion_mirror_id);

create or replace function public.extract_solucion_package(p_text text)
returns table(package_size numeric, package_unit text)
language plpgsql
immutable
as $$
declare
  v_match text[];
  v_unit text;
begin
  select regexp_match(
    lower(replace(coalesce(p_text, ''), '_', ' ')),
    '([0-9]+(?:[\.,][0-9]+)?)\s*(lts?|lt|ltr|litros?|l|kgs?|kg|grs?|gr|ml|cc)([^a-z0-9]|$)'
  )
  into v_match;

  if v_match is null then
    return query select null::numeric, null::text;
    return;
  end if;

  v_unit := replace(v_match[2], '.', '');

  return query
  select
    replace(v_match[1], ',', '.')::numeric,
    case
      when v_unit in ('lt', 'lts', 'ltr', 'l', 'litro', 'litros') then 'lt'
      when v_unit in ('kg', 'kgs') then 'kg'
      when v_unit in ('gr', 'grs') then 'gr'
      when v_unit = 'ml' then 'ml'
      when v_unit = 'cc' then 'cc'
      else v_unit
    end;
end;
$$;

-- Importa clientes de Solucion como directorio de clientes.
insert into public.clients (name, contact, notes, solucion_codigo)
select
  sc.name,
  coalesce(nullif(sc.contact, ''), nullif(sc.phone, ''), nullif(sc.email, '')),
  'Cliente sincronizado desde Solucion',
  sc.solucion_codigo
from public.solucion_clients sc
where sc.name is not null
on conflict (solucion_codigo) do update
set
  name = excluded.name,
  contact = coalesce(nullif(public.clients.contact, ''), excluded.contact),
  notes = case
    when public.clients.notes is null or trim(public.clients.notes) = '' then excluded.notes
    else public.clients.notes
  end;

-- Cliente interno usado para stock propio de Todo Agricola.
insert into public.clients (name, contact, notes, solucion_codigo)
values ('TODO AGRICOLA BOLIVIANA LTDA', null, 'Cliente interno para inventario sincronizado desde Solucion', 0)
on conflict (solucion_codigo) do update
set name = excluded.name;

-- Archiva el inventario anterior para que no se mezcle con Solucion.
update public.lots
set
  inventory_source = 'legacy',
  current_quantity = 0,
  status = 'cerrado',
  updated_at = now()
where coalesce(inventory_source, 'app') <> 'solucion';

with company_client as (
  select id
  from public.clients
  where solucion_codigo = 0
  limit 1
),
solucion_lots as (
  select
    ss.mirror_id,
    ss.product_code,
    ss.warehouse_code,
    ss.lot_code,
    ss.expiry_date,
    ss.current_quantity,
    sp.name as product_name,
    sw.name as warehouse_name,
    pkg.package_size,
    pkg.package_unit
  from public.solucion_stock ss
  left join public.solucion_products sp on sp.product_code = ss.product_code
  left join public.solucion_warehouses sw on sw.warehouse_code = ss.warehouse_code
  cross join lateral public.extract_solucion_package(coalesce(sp.name, ss.product_code)) pkg
  where coalesce(ss.current_quantity, 0) > 0
)
insert into public.lots (
  lot_code,
  client_id,
  product,
  current_quantity,
  entry_boxes,
  entry_units_per_box,
  entry_loose_units,
  package_size,
  package_unit,
  location,
  entry_date,
  expiry_date,
  status,
  photo_url,
  low_stock_threshold,
  qr_token,
  inventory_source,
  solucion_mirror_id,
  solucion_product_code,
  solucion_warehouse_code,
  solucion_synced_at
)
select
  left('SOL-' || regexp_replace(sl.mirror_id, '[| ]+', '-', 'g'), 120) as lot_code,
  cc.id as client_id,
  trim(coalesce(sl.product_name, sl.product_code) || ' (' || ltrim(sl.product_code, '0') || ')') as product,
  sl.current_quantity,
  0,
  0,
  sl.current_quantity,
  sl.package_size,
  sl.package_unit,
  coalesce(nullif(sl.warehouse_name, ''), 'Solucion'),
  current_date,
  sl.expiry_date,
  'activo',
  null,
  5,
  encode(gen_random_bytes(24), 'hex'),
  'solucion',
  sl.mirror_id,
  sl.product_code,
  sl.warehouse_code,
  now()
from solucion_lots sl
cross join company_client cc
on conflict (solucion_mirror_id) do update
set
  product = excluded.product,
  current_quantity = excluded.current_quantity,
  entry_loose_units = excluded.entry_loose_units,
  package_size = excluded.package_size,
  package_unit = excluded.package_unit,
  location = excluded.location,
  expiry_date = excluded.expiry_date,
  status = 'activo',
  inventory_source = 'solucion',
  solucion_product_code = excluded.solucion_product_code,
  solucion_warehouse_code = excluded.solucion_warehouse_code,
  solucion_synced_at = now(),
  updated_at = now();

-- Si Solucion ya no reporta stock positivo, el lote queda cerrado.
update public.lots l
set
  current_quantity = 0,
  status = 'cerrado',
  solucion_synced_at = now(),
  updated_at = now()
where l.inventory_source = 'solucion'
  and not exists (
    select 1
    from public.solucion_stock ss
    where ss.mirror_id = l.solucion_mirror_id
      and coalesce(ss.current_quantity, 0) > 0
  );

select
  (select count(*) from public.clients where solucion_codigo is not null) as clientes_solucion,
  (select count(*) from public.lots where inventory_source = 'solucion' and status = 'activo') as lotes_activos_solucion,
  (select coalesce(sum(current_quantity), 0) from public.lots where inventory_source = 'solucion' and status = 'activo') as envases_solucion;
