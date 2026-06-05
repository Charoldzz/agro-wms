-- Usa el espejo de Solucion como inventario principal de la app.
-- Ejecutar despues de:
-- 1) supabase/solucion_mirror.sql
-- 2) tmp/solucion_mirror/solucion_mirror_import.sql
--
-- Este script no borra auditoria ni movimientos. Archiva visualmente los lotes
-- anteriores y carga el stock positivo actual de Solucion en public.lots.

create extension if not exists "pgcrypto";

-- Solo estos almacenes de Solucion se consideran clientes de almacen para la app.
-- Si se agrega o quita un cliente de almacen, actualizar esta lista.
create temp table if not exists allowed_solucion_warehouses (
  warehouse_code bigint primary key,
  warehouse_name text not null
) on commit drop;

truncate table allowed_solucion_warehouses;

insert into allowed_solucion_warehouses (warehouse_code, warehouse_name)
values
  (17, 'ALMACEN GAT BOLIVIA'),
  (21, 'AGRO PARCEL'),
  (24, 'TECNOMYL'),
  (25, 'CIAGRO S.A'),
  (27, 'TOTAL AGRO S.A'),
  (28, 'AGROPECUARIA GUANANDI SRL (TECNOMYL)'),
  (32, 'AUBREY REINALDO VIRICA'),
  (35, 'DENIS BARBIERI'),
  (40, 'TOTAL PEC S.R.L'),
  (41, 'ADILSON SABEC'),
  (42, 'AGRONEULAND S.R.L'),
  (44, 'MAXIAGRO SRL'),
  (45, 'FOLCOL'),
  (47, 'DISAN SRL'),
  (48, 'ZENTTA BIO'),
  (49, 'ALBAUGH'),
  (50, 'AGRICOLA RIO VICTORIA S.R.L'),
  (51, 'SOGIMA S.R.L'),
  (52, 'GRANODEST S.R.L'),
  (53, 'BRONCOS S.R.L'),
  (54, 'UPL BOLIVIA S.R.L'),
  (55, 'AGROCALY'),
  (56, 'JACOBO MARTENS'),
  (57, 'DAVID WIEBEB'),
  (58, 'LA BENDECIDA')
on conflict (warehouse_code) do update
set warehouse_name = excluded.warehouse_name;

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

-- No importamos todo el directorio comercial de Solucion.
-- Para la app de almacen solo se muestran los almacenes autorizados de arriba.

-- Cliente interno usado para stock propio de Todo Agricola.
insert into public.clients (name, contact, notes, solucion_codigo)
values ('TODO AGRICOLA BOLIVIANA LTDA', null, 'Cliente interno para inventario sincronizado desde Solucion', 0)
on conflict (solucion_codigo) do update
set name = excluded.name;

-- En esta importacion, los "almacenes" de Solucion representan el cliente/empresa
-- que debe verse destacado en la app. La ubicacion operativa se fija abajo.
insert into public.clients (name, contact, notes, solucion_codigo)
select
  allowed.warehouse_name,
  null,
  'Cliente creado desde almacenes Solucion',
  -abs(allowed.warehouse_code)
from allowed_solucion_warehouses allowed
join public.solucion_warehouses sw on sw.warehouse_code = allowed.warehouse_code
on conflict (solucion_codigo) do update
set name = excluded.name;

-- Oculta clientes de Solucion que no pertenecen a los almacenes autorizados.
-- No borra historial; solo evita que aparezcan en listas operativas filtradas por Solucion.
update public.clients client
set solucion_codigo = null
where client.solucion_codigo is not null
  and client.solucion_codigo <> 0
  and client.solucion_codigo not in (
    select -abs(warehouse_code)
    from allowed_solucion_warehouses
  );

-- Archiva el inventario anterior para que no se mezcle con Solucion.
update public.lots
set
  inventory_source = 'legacy',
  current_quantity = 0,
  status = 'cerrado',
  updated_at = now()
where coalesce(inventory_source, 'app') <> 'solucion';

with solucion_lots as (
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
  join allowed_solucion_warehouses allowed on allowed.warehouse_code = ss.warehouse_code
  cross join lateral public.extract_solucion_package(coalesce(sp.name, ss.product_code)) pkg
  where coalesce(ss.current_quantity, 0) > 0
),
solucion_lots_with_client as (
  select
    sl.*,
    coalesce(cw.id, ci.id) as client_id
  from solucion_lots sl
  left join public.clients cw on cw.solucion_codigo = -abs(sl.warehouse_code)
  left join public.clients ci on ci.solucion_codigo = 0
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
  sl.client_id,
  trim(coalesce(sl.product_name, sl.product_code) || ' (' || ltrim(sl.product_code, '0') || ')') as product,
  sl.current_quantity,
  0,
  0,
  sl.current_quantity,
  sl.package_size,
  sl.package_unit,
  'Deposito Warnes',
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
from solucion_lots_with_client sl
on conflict (solucion_mirror_id) do update
set
  client_id = excluded.client_id,
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
    join allowed_solucion_warehouses allowed on allowed.warehouse_code = ss.warehouse_code
    where ss.mirror_id = l.solucion_mirror_id
      and coalesce(ss.current_quantity, 0) > 0
  );

select
  (select count(*) from allowed_solucion_warehouses) as almacenes_autorizados,
  (select count(*) from public.clients where solucion_codigo is not null and solucion_codigo <> 0) as clientes_solucion_visibles,
  (select count(*) from public.lots where inventory_source = 'solucion' and status = 'activo') as lotes_activos_solucion,
  (select coalesce(sum(current_quantity), 0) from public.lots where inventory_source = 'solucion' and status = 'activo') as envases_solucion;
