-- ============================================================
-- 01 · LIMPIEZA TOTAL antes de importar datos del programa
-- Borra TODA la mercaderia. CONSERVA usuarios, perfiles y estructura.
-- ============================================================
begin;

do $$
begin
  if exists (select 1 from pg_trigger
             where tgname = 'movements_prevent_delete'
               and tgrelid = 'public.movements'::regclass and not tgisinternal) then
    alter table public.movements disable trigger movements_prevent_delete;
  end if;

  update public.profiles set client_id = null where client_id is not null;

  if to_regclass('public.movement_correction_requests') is not null then delete from public.movement_correction_requests; end if;
  if to_regclass('public.operational_issue_reports')   is not null then delete from public.operational_issue_reports;   end if;
  if to_regclass('public.movements')                   is not null then delete from public.movements;                   end if;
  if to_regclass('public.warehouse_operation_items')   is not null then delete from public.warehouse_operation_items;   end if;
  if to_regclass('public.warehouse_operations')        is not null then delete from public.warehouse_operations;        end if;
  if to_regclass('public.client_dispatch_requests')    is not null then delete from public.client_dispatch_requests;    end if;
  if to_regclass('public.lots')                        is not null then delete from public.lots;                        end if;
  -- FALTABAN en reset_pilot_data.sql (evitan mezclar catalogo/historico viejo):
  if to_regclass('public.product_catalog')             is not null then delete from public.product_catalog;             end if;
  if to_regclass('public.desktop_movements')           is not null then delete from public.desktop_movements;           end if;
  if to_regclass('public.clients')                     is not null then delete from public.clients;                     end if;
  -- espejo viejo de Solucion
  if to_regclass('public.solucion_operation_lines')    is not null then delete from public.solucion_operation_lines;    end if;
  if to_regclass('public.solucion_operation_headers')  is not null then delete from public.solucion_operation_headers;  end if;
  if to_regclass('public.solucion_stock')              is not null then delete from public.solucion_stock;              end if;
  if to_regclass('public.solucion_products')           is not null then delete from public.solucion_products;           end if;
  if to_regclass('public.solucion_warehouses')         is not null then delete from public.solucion_warehouses;         end if;
  if to_regclass('public.solucion_clients')            is not null then delete from public.solucion_clients;            end if;

  if to_regclass('public.warehouse_operation_counters') is not null then
    insert into public.warehouse_operation_counters (counter_name, next_number) values ('guide', 1)
    on conflict (counter_name) do update set next_number = excluded.next_number;
  end if;

  if exists (select 1 from pg_trigger
             where tgname = 'movements_prevent_delete'
               and tgrelid = 'public.movements'::regclass and not tgisinternal) then
    alter table public.movements enable trigger movements_prevent_delete;
  end if;
end $$;

commit;

-- Debe dar todo en 0 salvo perfiles_conservados.
select
  (select count(*) from public.profiles)          as perfiles_conservados,
  (select count(*) from public.clients)           as clientes,
  (select count(*) from public.lots)              as lotes,
  (select count(*) from public.movements)         as movimientos,
  (select count(*) from public.product_catalog)   as catalogo,
  (select count(*) from public.desktop_movements) as historico_programa;
