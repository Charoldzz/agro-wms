-- ============================================================
-- 20 · EMPRESA DE PRUEBA (para no volver a tocar datos reales)
--
-- Crea una empresa ficticia con productos y lotes que cubren TODOS los casos
-- interesantes, para poder probar ingreso, salida, reparacion y solicitudes
-- sin ensuciar TECNOMYL, MAXIAGRO ni ninguna empresa real.
--
-- Se distingue facil:
--   · Nombre "ZZZ EMPRESA DE PRUEBA" -> queda ULTIMA en todas las listas
--   · Codigo de almacen 999 (los reales van del 1 al 58)
--   · Prefijo de producto ZZPR (ningun producto real lo usa)
--   · Lotes con codigo PRUEBA-xxx
--
-- Para borrarla despues: delete from public.clients where solucion_codigo = 999;
-- (los lotes, movimientos y fichas se van solos por las relaciones)
-- ============================================================
begin;

-- 1) La empresa
insert into public.clients (name, contact, inventory_source, product_code_prefix, solucion_codigo, notes)
values ('ZZZ EMPRESA DE PRUEBA', 'USO INTERNO', 'stock_independiente', 'ZZPR', 999,
        'Empresa ficticia para pruebas. NO es un cliente real. Borrar antes del cierre del piloto.')
on conflict do nothing;

-- 2) Fichas de producto: una por cada tipo de envase
insert into public.product_catalog (client_id, code, name, package_size, package_unit, pallet_units_per_pallet)
select c.id, v.code, v.name, v.size, v.unit, v.pallet
from public.clients c,
(values
  ('ZZPR-00001', 'PRUEBA LIQUIDO X 20 LTS.',   20,   'lt',  960),
  ('ZZPR-00002', 'PRUEBA LIQUIDO X 5 LTS.',     5,   'lt',  720),
  ('ZZPR-00003', 'PRUEBA SOLIDO X 25 KGS.',    25,   'kg', 1000),
  ('ZZPR-00004', 'PRUEBA FRASCO X 500 ML',    500,   'ml',  600),
  ('ZZPR-00005', 'PRUEBA SIN PRESENTACION',  null,   null, null)
) as v(code, name, size, unit, pallet)
where c.solucion_codigo = 999
on conflict (code) do nothing;

-- 3) Lotes con stock. OJO: current_quantity va en EQUIVALENTE (lts/kgs),
--    y en ml/gr en la unidad cruda. Los envases los calcula la app.
insert into public.lots (
  lot_code, client_id, product, current_quantity,
  entry_boxes, entry_units_per_box, entry_loose_units,
  package_size, package_unit, pallet_units_per_pallet,
  location, entry_date, expiry_date, status, low_stock_threshold, qr_token,
  inventory_source, solucion_mirror_id, solucion_product_code, solucion_warehouse_code, solucion_synced_at
)
select
  v.lot_code, c.id, v.product, v.qty,
  0, 0, v.qty,
  v.size, v.unit, v.pallet,
  'Deposito Warnes', current_date, v.venc, 'activo', 5, encode(gen_random_bytes(24), 'hex'),
  'stock_independiente', 'ZZPR-999-' || v.lot_code, v.code, 999, now()
from public.clients c,
(values
  -- codigo lote      producto                       cantidad  present. unid  pallet  vencimiento
  ('PRUEBA-001', 'PRUEBA LIQUIDO X 20 LTS.',  'ZZPR-00001',  2000.0,   20,  'lt',   960, (current_date + 400)),
  ('PRUEBA-002', 'PRUEBA LIQUIDO X 5 LTS.',   'ZZPR-00002',   500.0,    5,  'lt',   720, (current_date + 60)),
  ('PRUEBA-003', 'PRUEBA SOLIDO X 25 KGS.',   'ZZPR-00003',  2500.0,   25,  'kg',  1000, (current_date + 200)),
  ('PRUEBA-004', 'PRUEBA FRASCO X 500 ML',    'ZZPR-00004', 50000.0,  500,  'ml',   600, (current_date + 300)),
  ('PRUEBA-005', 'PRUEBA SIN PRESENTACION',   'ZZPR-00005',   100.0, null,  null,  null, null),
  -- Lote VENCIDO a proposito: sirve para comprobar que el vencimiento
  -- avisa pero NO bloquea la salida.
  ('PRUEBA-006', 'PRUEBA LIQUIDO X 20 LTS.',  'ZZPR-00001',  1000.0,   20,  'lt',   960, (current_date - 30))
) as v(lot_code, product, code, qty, size, unit, pallet, venc)
where c.solucion_codigo = 999
on conflict (lot_code) do nothing;

commit;

-- ============================================================
-- VERIFICACION
-- ============================================================
select
  c.name                as empresa,
  c.solucion_codigo     as cod,
  count(l.id)           as lotes,
  count(*) filter (where l.expiry_date < current_date) as vencidos
from public.clients c
left join public.lots l on l.client_id = c.id
where c.solucion_codigo = 999
group by c.name, c.solucion_codigo;

-- Detalle: asi tiene que verse en la app
select
  l.lot_code,
  l.product,
  l.current_quantity        as cantidad_guardada,
  l.package_size,
  l.package_unit,
  l.pallet_units_per_pallet as por_pallet,
  l.expiry_date,
  case when l.expiry_date < current_date then 'VENCIDO' else '' end as estado
from public.lots l
join public.clients c on c.id = l.client_id
where c.solucion_codigo = 999
order by l.lot_code;
