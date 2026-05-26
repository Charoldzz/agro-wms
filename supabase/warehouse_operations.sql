-- Operaciones formales de almacen.
-- Ejecutar una vez en Supabase SQL Editor antes de usar la version que
-- registra ingresos y despachos como documentos con lineas.

create table if not exists public.warehouse_operations (
  id uuid primary key default gen_random_uuid(),
  operation_code text not null unique,
  guide_number text,
  type text not null check (type in ('ingreso', 'despacho', 'reparo', 'traslado', 'ajuste')),
  status text not null default 'aplicado' check (status in ('borrador', 'pendiente', 'aplicado', 'rechazado', 'anulado')),
  source text not null default 'app',
  client_id uuid references public.clients(id),
  receiver_name text,
  receiver_document text,
  driver_name text,
  driver_document text,
  vehicle_plate text,
  notes text,
  photo_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.warehouse_operations
add column if not exists guide_number text;

create unique index if not exists warehouse_operations_guide_number_key
on public.warehouse_operations(guide_number)
where guide_number is not null;

create table if not exists public.warehouse_operation_counters (
  counter_name text primary key,
  next_number bigint not null default 1 check (next_number > 0)
);

insert into public.warehouse_operation_counters (counter_name, next_number)
values ('guide', 1)
on conflict (counter_name) do nothing;

update public.warehouse_operation_counters c
set next_number = greatest(
  c.next_number,
  coalesce((
    select max(nullif(regexp_replace(guide_number, '\D', '', 'g'), '')::bigint) + 1
    from public.warehouse_operations
    where guide_number ~ '^TAB[0-9]+$'
  ), 1)
)
where c.counter_name = 'guide';

create table if not exists public.warehouse_operation_items (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.warehouse_operations(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  lot_id uuid references public.lots(id) on delete restrict,
  lot_code text,
  product text not null,
  quantity numeric(12, 2) not null check (quantity >= 0),
  previous_quantity numeric(12, 2),
  new_quantity numeric(12, 2),
  box_count numeric(12, 2),
  units_per_box numeric(12, 2),
  loose_units numeric(12, 2),
  package_size numeric(12, 2),
  package_unit text,
  from_location text,
  to_location text,
  expiry_date date,
  notes text,
  created_at timestamptz not null default now(),
  unique (operation_id, line_number)
);

alter table public.movements
add column if not exists operation_id uuid references public.warehouse_operations(id) on delete restrict;

alter table public.movements
add column if not exists operation_item_id uuid references public.warehouse_operation_items(id) on delete restrict;

create index if not exists warehouse_operations_created_at_idx
on public.warehouse_operations(created_at desc);

create index if not exists warehouse_operations_client_created_at_idx
on public.warehouse_operations(client_id, created_at desc);

create index if not exists warehouse_operation_items_operation_idx
on public.warehouse_operation_items(operation_id, line_number);

create index if not exists movements_operation_created_at_idx
on public.movements(operation_id, created_at desc);

drop trigger if exists warehouse_operations_set_updated_at on public.warehouse_operations;
create trigger warehouse_operations_set_updated_at
before update on public.warehouse_operations
for each row execute function public.set_updated_at();

alter table public.warehouse_operations enable row level security;
alter table public.warehouse_operation_items enable row level security;

drop policy if exists "Equipo lee operaciones de almacen" on public.warehouse_operations;
create policy "Equipo lee operaciones de almacen"
on public.warehouse_operations for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('administrador', 'operador')
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text = 'cliente'
      and p.client_id = warehouse_operations.client_id
  )
);

drop policy if exists "Equipo lee lineas de operaciones" on public.warehouse_operation_items;
create policy "Equipo lee lineas de operaciones"
on public.warehouse_operation_items for select
to authenticated
using (
  exists (
    select 1
    from public.warehouse_operations o
    join public.profiles p on p.id = auth.uid()
    where o.id = warehouse_operation_items.operation_id
      and (
        p.role::text in ('administrador', 'operador')
        or (p.role::text = 'cliente' and p.client_id = o.client_id)
      )
  )
);

create or replace function public.new_warehouse_operation_code(p_prefix text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(trim(p_prefix))
      || '-'
      || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
      || '-'
      || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1
      from public.warehouse_operations
      where operation_code = v_code
    );
  end loop;

  return v_code;
end;
$$;

grant execute on function public.new_warehouse_operation_code(text) to authenticated;

create or replace function public.preview_next_warehouse_guide()
returns text
language sql
security definer
set search_path = public
as $$
  select 'TAB' || lpad(next_number::text, 3, '0')
  from public.warehouse_operation_counters
  where counter_name = 'guide';
$$;

grant execute on function public.preview_next_warehouse_guide() to authenticated;

create or replace function public.next_warehouse_guide()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_number bigint;
begin
  update public.warehouse_operation_counters
  set next_number = next_number + 1
  where counter_name = 'guide'
  returning next_number - 1 into v_number;

  if v_number is null then
    insert into public.warehouse_operation_counters (counter_name, next_number)
    values ('guide', 2)
    on conflict (counter_name) do update
    set next_number = public.warehouse_operation_counters.next_number + 1
    returning public.warehouse_operation_counters.next_number - 1 into v_number;
  end if;

  return 'TAB' || lpad(v_number::text, 3, '0');
end;
$$;

grant execute on function public.next_warehouse_guide() to authenticated;

create or replace function public.create_entry_operation(
  p_client_id uuid,
  p_driver_name text,
  p_driver_document text,
  p_vehicle_plate text,
  p_entry_date date,
  p_photo_url text,
  p_notes text,
  p_items jsonb,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_operation_id uuid;
  v_operation_code text;
  v_guide_number text;
  v_item jsonb;
  v_item_id uuid;
  v_lot_id uuid;
  v_line integer := 0;
  v_lot_code text;
  v_product text;
  v_box_count numeric(12, 2);
  v_units_per_box numeric(12, 2);
  v_loose_units numeric(12, 2);
  v_quantity numeric(12, 2);
  v_package_size numeric(12, 2);
  v_location text;
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del ingreso no coincide con la sesion activa.';
  end if;

  select role::text into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para registrar ingresos.';
  end if;

  if p_client_id is null then
    raise exception 'Selecciona el cliente del ingreso.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto al ingreso.';
  end if;

  if coalesce(trim(p_driver_name), '') = ''
     or coalesce(trim(p_driver_document), '') = ''
     or coalesce(trim(p_vehicle_plate), '') = '' then
    raise exception 'Completa chofer, documento y placa del ingreso.';
  end if;

  v_operation_code := public.new_warehouse_operation_code('ING');
  v_guide_number := public.next_warehouse_guide();

  insert into public.warehouse_operations (
    operation_code,
    guide_number,
    type,
    status,
    source,
    client_id,
    driver_name,
    driver_document,
    vehicle_plate,
    notes,
    photo_url,
    created_by
  )
  values (
    v_operation_code,
    v_guide_number,
    'ingreso',
    'aplicado',
    'app',
    p_client_id,
    trim(p_driver_name),
    trim(p_driver_document),
    upper(trim(p_vehicle_plate)),
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_photo_url, '')), ''),
    p_user_id
  )
  returning id into v_operation_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    v_product := trim(coalesce(v_item->>'product', ''));
    v_lot_code := trim(coalesce(v_item->>'lot_code', ''));
    v_box_count := greatest(coalesce(nullif(v_item->>'box_count', '')::numeric, 0), 0);
    v_units_per_box := greatest(coalesce(nullif(v_item->>'units_per_box', '')::numeric, 0), 0);
    v_loose_units := greatest(coalesce(nullif(v_item->>'loose_units', '')::numeric, 0), 0);
    v_package_size := nullif(v_item->>'package_size', '')::numeric;
    v_location := trim(coalesce(v_item->>'location', ''));
    v_quantity := v_box_count * v_units_per_box + v_loose_units;

    if v_product = '' then
      raise exception 'Cada linea del ingreso necesita producto.';
    end if;

    if v_lot_code = '' then
      v_lot_code := v_operation_code || '-' || lpad(v_line::text, 2, '0');
    end if;

    if v_box_count > 0 and v_units_per_box <= 0 then
      raise exception 'Indica cuantos envases vienen por caja en %.', v_product;
    end if;

    if v_quantity <= 0 then
      raise exception 'La linea % no tiene envases para ingresar.', v_product;
    end if;

    if v_location = '' then
      raise exception 'La linea % necesita ubicacion.', v_product;
    end if;

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
      low_stock_threshold
    )
    values (
      v_lot_code,
      p_client_id,
      v_product,
      v_quantity,
      v_box_count,
      v_units_per_box,
      v_loose_units,
      v_package_size,
      nullif(trim(coalesce(v_item->>'package_unit', '')), ''),
      v_location,
      coalesce(p_entry_date, current_date),
      nullif(v_item->>'expiry_date', '')::date,
      'activo',
      nullif(trim(coalesce(p_photo_url, '')), ''),
      5
    )
    returning id into v_lot_id;

    insert into public.warehouse_operation_items (
      operation_id,
      line_number,
      lot_id,
      lot_code,
      product,
      quantity,
      previous_quantity,
      new_quantity,
      box_count,
      units_per_box,
      loose_units,
      package_size,
      package_unit,
      from_location,
      to_location,
      expiry_date
    )
    values (
      v_operation_id,
      v_line,
      v_lot_id,
      v_lot_code,
      v_product,
      v_quantity,
      0,
      v_quantity,
      v_box_count,
      v_units_per_box,
      v_loose_units,
      v_package_size,
      nullif(trim(coalesce(v_item->>'package_unit', '')), ''),
      null,
      v_location,
      nullif(v_item->>'expiry_date', '')::date
    )
    returning id into v_item_id;

    insert into public.movements (
      operation_id,
      operation_item_id,
      lot_id,
      type,
      quantity,
      previous_quantity,
      new_quantity,
      from_location,
      to_location,
      notes,
      user_id
    )
    values (
      v_operation_id,
      v_item_id,
      v_lot_id,
      'entrada',
      v_quantity,
      0,
      v_quantity,
      null,
      v_location,
      concat_ws(' | ', 'Nuevo ingreso desde almacen.', nullif(trim(coalesce(p_notes, '')), '')),
      p_user_id
    );
  end loop;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'operation_code', v_operation_code,
    'guide_number', v_guide_number,
    'items', v_line
  );
end;
$$;

grant execute on function public.create_entry_operation(uuid, text, text, text, date, text, text, jsonb, uuid) to authenticated;

create or replace function public.create_dispatch_operation(
  p_client_id uuid,
  p_receiver_name text,
  p_receiver_document text,
  p_vehicle_plate text,
  p_notes text,
  p_items jsonb,
  p_request_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_operation_id uuid;
  v_operation_code text;
  v_guide_number text;
  v_operation_client_id uuid := p_client_id;
  v_item jsonb;
  v_item_id uuid;
  v_lot public.lots%rowtype;
  v_line integer := 0;
  v_lot_id uuid;
  v_quantity numeric(12, 2);
  v_new_quantity numeric(12, 2);
begin
  if p_user_id <> auth.uid() then
    raise exception 'El usuario del despacho no coincide con la sesion activa.';
  end if;

  select role::text into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('administrador', 'operador') then
    raise exception 'No tienes permiso para registrar despachos.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escanea al menos un lote.';
  end if;

  if coalesce(trim(p_receiver_name), '') = ''
     or coalesce(trim(p_receiver_document), '') = '' then
    raise exception 'Completa quien recibe y su documento.';
  end if;

  select nullif(value->>'lot_id', '')::uuid
  into v_lot_id
  from jsonb_array_elements(p_items)
  limit 1;

  select client_id
  into v_operation_client_id
  from public.lots
  where id = v_lot_id
    and v_operation_client_id is null;

  if v_operation_client_id is null then
    raise exception 'No se pudo definir el cliente del despacho.';
  end if;

  v_operation_code := public.new_warehouse_operation_code('DESP');
  v_guide_number := public.next_warehouse_guide();

  insert into public.warehouse_operations (
    operation_code,
    guide_number,
    type,
    status,
    source,
    client_id,
    receiver_name,
    receiver_document,
    vehicle_plate,
    notes,
    metadata,
    created_by
  )
  values (
    v_operation_code,
    v_guide_number,
    'despacho',
    'aplicado',
    case when p_request_id is null then 'app' else 'solicitud_cliente' end,
    v_operation_client_id,
    trim(p_receiver_name),
    trim(p_receiver_document),
    nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    case
      when p_request_id is null then '{}'::jsonb
      else jsonb_build_object('client_dispatch_request_id', p_request_id)
    end,
    p_user_id
  )
  returning id into v_operation_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_line := v_line + 1;
    v_lot_id := nullif(v_item->>'lot_id', '')::uuid;
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 0);

    select * into v_lot
    from public.lots
    where id = v_lot_id
    for update;

    if not found then
      raise exception 'Lote no encontrado en el despacho.';
    end if;

    if v_lot.client_id <> v_operation_client_id then
      raise exception 'Todos los productos del despacho deben pertenecer al mismo cliente.';
    end if;

    if v_quantity <= 0 then
      raise exception 'La cantidad a despachar debe ser mayor a cero.';
    end if;

    if v_lot.status in ('retenido', 'cerrado') then
      raise exception 'No se puede despachar un lote retenido o cerrado.';
    end if;

    if v_lot.expiry_date is not null and v_lot.expiry_date < current_date then
      raise exception 'No se puede despachar un lote vencido.';
    end if;

    if v_quantity > v_lot.current_quantity then
      raise exception 'No hay inventario suficiente.';
    end if;

    v_new_quantity := v_lot.current_quantity - v_quantity;

    insert into public.warehouse_operation_items (
      operation_id,
      line_number,
      lot_id,
      lot_code,
      product,
      quantity,
      previous_quantity,
      new_quantity,
      package_size,
      package_unit,
      from_location,
      to_location,
      expiry_date
    )
    values (
      v_operation_id,
      v_line,
      v_lot.id,
      v_lot.lot_code,
      v_lot.product,
      v_quantity,
      v_lot.current_quantity,
      v_new_quantity,
      v_lot.package_size,
      v_lot.package_unit,
      v_lot.location,
      nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
      v_lot.expiry_date
    )
    returning id into v_item_id;

    update public.lots
    set current_quantity = v_new_quantity
    where id = v_lot.id;

    insert into public.movements (
      operation_id,
      operation_item_id,
      lot_id,
      type,
      quantity,
      previous_quantity,
      new_quantity,
      from_location,
      to_location,
      notes,
      user_id
    )
    values (
      v_operation_id,
      v_item_id,
      v_lot.id,
      'salida',
      v_quantity,
      v_lot.current_quantity,
      v_new_quantity,
      v_lot.location,
      nullif(upper(trim(coalesce(p_vehicle_plate, ''))), ''),
      concat_ws(
        ' | ',
        nullif(concat('Placa: ', nullif(upper(trim(coalesce(p_vehicle_plate, ''))), '')), 'Placa: '),
        concat('Recibe: ', trim(p_receiver_name)),
        concat('Documento: ', trim(p_receiver_document)),
        'Despacho por lista',
        nullif(trim(coalesce(p_notes, '')), '')
      ),
      p_user_id
    );
  end loop;

  return jsonb_build_object(
    'operation_id', v_operation_id,
    'operation_code', v_operation_code,
    'guide_number', v_guide_number,
    'items', v_line
  );
end;
$$;

grant execute on function public.create_dispatch_operation(uuid, text, text, text, text, jsonb, uuid, uuid) to authenticated;
