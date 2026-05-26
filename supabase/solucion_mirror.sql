create table if not exists public.solucion_clients (
  solucion_codigo bigint primary key,
  name text not null,
  phone text,
  email text,
  contact text,
  status numeric,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_products (
  product_code text primary key,
  barcode text,
  name text not null,
  unit_code numeric,
  min_stock numeric,
  inactive boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_warehouses (
  warehouse_code bigint primary key,
  name text not null,
  short_name text,
  responsible text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_stock (
  mirror_id text primary key,
  product_code text not null,
  warehouse_code bigint,
  lot_code text,
  expiry_date date,
  current_quantity numeric,
  incoming_quantity numeric,
  outgoing_quantity numeric,
  reserved_quantity numeric,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_operation_headers (
  mirror_id text primary key,
  operation_type text not null,
  document_number bigint not null,
  document_date date,
  client_or_provider_code bigint,
  warehouse_code bigint,
  origin_warehouse_code bigint,
  destination_warehouse_code bigint,
  concept text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_operation_lines (
  mirror_id text primary key,
  operation_type text not null,
  document_number bigint not null,
  line_number bigint not null,
  product_code text,
  quantity numeric,
  lot_code text,
  expiry_date date,
  warehouse_code bigint,
  product_name text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists solucion_clients_name_idx on public.solucion_clients using btree (name);
create index if not exists solucion_products_name_idx on public.solucion_products using btree (name);
create index if not exists solucion_stock_product_idx on public.solucion_stock using btree (product_code);
create index if not exists solucion_stock_warehouse_idx on public.solucion_stock using btree (warehouse_code);
create index if not exists solucion_operation_headers_type_date_idx on public.solucion_operation_headers (operation_type, document_date desc);
create index if not exists solucion_operation_lines_doc_idx on public.solucion_operation_lines (operation_type, document_number);

alter table public.solucion_clients enable row level security;
alter table public.solucion_products enable row level security;
alter table public.solucion_warehouses enable row level security;
alter table public.solucion_stock enable row level security;
alter table public.solucion_operation_headers enable row level security;
alter table public.solucion_operation_lines enable row level security;

drop policy if exists "Usuarios autenticados leen clientes Solucion" on public.solucion_clients;
create policy "Usuarios autenticados leen clientes Solucion"
on public.solucion_clients for select
to authenticated
using (true);

drop policy if exists "Usuarios autenticados leen productos Solucion" on public.solucion_products;
create policy "Usuarios autenticados leen productos Solucion"
on public.solucion_products for select
to authenticated
using (true);

drop policy if exists "Usuarios autenticados leen almacenes Solucion" on public.solucion_warehouses;
create policy "Usuarios autenticados leen almacenes Solucion"
on public.solucion_warehouses for select
to authenticated
using (true);

drop policy if exists "Usuarios autenticados leen stock Solucion" on public.solucion_stock;
create policy "Usuarios autenticados leen stock Solucion"
on public.solucion_stock for select
to authenticated
using (true);

drop policy if exists "Admins leen cabeceras Solucion" on public.solucion_operation_headers;
create policy "Admins leen cabeceras Solucion"
on public.solucion_operation_headers for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'administrador'
  )
);

drop policy if exists "Admins leen detalles Solucion" on public.solucion_operation_lines;
create policy "Admins leen detalles Solucion"
on public.solucion_operation_lines for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'administrador'
  )
);
