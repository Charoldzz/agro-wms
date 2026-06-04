-- RESET DE DATOS PARA PILOTO OFICIAL
--
-- Objetivo:
-- - Limpiar datos antiguos, de Excel y de prueba.
-- - Conservar usuarios, perfiles, roles, politicas, funciones y estructura.
-- - Dejar la base lista para importar nuevamente datos oficiales de Solucion.
--
-- NO borra:
-- - auth.users
-- - public.profiles
-- - roles/permisos/RLS
-- - funciones SQL
-- - codigo de la app
--
-- SI borra:
-- - clientes
-- - lotes
-- - movimientos
-- - operaciones de almacen
-- - solicitudes de despacho
-- - correcciones/reportes/incidencias
-- - espejo/importacion de Solucion

begin;

do $$
begin
  -- Reset administrativo: se desactiva temporalmente la proteccion
  -- que impide borrar movimientos. Se vuelve a activar al final.
  if exists (
    select 1
    from pg_trigger
    where tgname = 'movements_prevent_delete'
      and tgrelid = 'public.movements'::regclass
      and not tgisinternal
  ) then
    alter table public.movements disable trigger movements_prevent_delete;
  end if;

  -- Desvincula perfiles cliente antes de borrar clientes.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'client_id'
  ) then
    update public.profiles
    set client_id = null
    where client_id is not null;
  end if;

  -- Datos operativos dependientes.
  if to_regclass('public.movement_correction_requests') is not null then
    delete from public.movement_correction_requests;
  end if;

  if to_regclass('public.operational_issue_reports') is not null then
    delete from public.operational_issue_reports;
  end if;

  if to_regclass('public.movements') is not null then
    delete from public.movements;
  end if;

  if to_regclass('public.warehouse_operation_items') is not null then
    delete from public.warehouse_operation_items;
  end if;

  if to_regclass('public.warehouse_operations') is not null then
    delete from public.warehouse_operations;
  end if;

  if to_regclass('public.client_dispatch_requests') is not null then
    delete from public.client_dispatch_requests;
  end if;

  -- Inventario visible de la app.
  if to_regclass('public.lots') is not null then
    delete from public.lots;
  end if;

  if to_regclass('public.clients') is not null then
    delete from public.clients;
  end if;

  -- Espejo de Solucion. Se limpia para evitar mezclar importaciones viejas.
  if to_regclass('public.solucion_operation_lines') is not null then
    delete from public.solucion_operation_lines;
  end if;

  if to_regclass('public.solucion_operation_headers') is not null then
    delete from public.solucion_operation_headers;
  end if;

  if to_regclass('public.solucion_stock') is not null then
    delete from public.solucion_stock;
  end if;

  if to_regclass('public.solucion_products') is not null then
    delete from public.solucion_products;
  end if;

  if to_regclass('public.solucion_warehouses') is not null then
    delete from public.solucion_warehouses;
  end if;

  if to_regclass('public.solucion_clients') is not null then
    delete from public.solucion_clients;
  end if;

  -- Reinicia numeracion interna de guias para el piloto.
  if to_regclass('public.warehouse_operation_counters') is not null then
    insert into public.warehouse_operation_counters (counter_name, next_number)
    values ('guide', 1)
    on conflict (counter_name)
    do update set next_number = excluded.next_number;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgname = 'movements_prevent_delete'
      and tgrelid = 'public.movements'::regclass
      and not tgisinternal
  ) then
    alter table public.movements enable trigger movements_prevent_delete;
  end if;
end $$;

commit;

-- Si todo salio bien, clientes/lotes/movimientos/solicitudes deben quedar en 0.
-- Los usuarios/perfiles se conservan.
select
  (select count(*) from public.profiles) as perfiles_conservados,
  (select count(*) from public.clients) as clientes,
  (select count(*) from public.lots) as lotes,
  (select count(*) from public.movements) as movimientos,
  (select count(*) from public.client_dispatch_requests) as solicitudes_despacho,
  (select count(*) from public.warehouse_operations) as operaciones,
  (select count(*) from public.warehouse_operation_items) as lineas_operacion,
  (select count(*) from public.solucion_clients) as solucion_clientes,
  (select count(*) from public.solucion_products) as solucion_productos,
  (select count(*) from public.solucion_stock) as solucion_stock;
