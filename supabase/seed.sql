insert into public.clients (id, name, contact, notes)
values
  ('10000000-0000-0000-0000-000000000001', 'Agropecuaria Santa Cruz SRL', '+591 70000001', 'Cliente frecuente de grano seco.'),
  ('10000000-0000-0000-0000-000000000002', 'Cooperativa Valle Alto', '+591 70000002', 'Requiere separación por campaña.'),
  ('10000000-0000-0000-0000-000000000003', 'Productores del Norte', '+591 70000003', 'Revisar humedad antes de salida.');

insert into public.lots (
  id,
  lot_code,
  client_id,
  product,
  current_quantity,
  location,
  entry_date,
  status,
  low_stock_threshold
)
values
  ('20000000-0000-0000-0000-000000000001', 'LOT-MAIZ-2026-001', '10000000-0000-0000-0000-000000000001', 'Maiz amarillo', 120.00, 'Galpon A / Fila 1', '2026-05-01', 'activo', 20),
  ('20000000-0000-0000-0000-000000000002', 'LOT-SOYA-2026-014', '10000000-0000-0000-0000-000000000002', 'Soya', 45.50, 'Galpon B / Fila 3', '2026-05-07', 'activo', 10),
  ('20000000-0000-0000-0000-000000000003', 'LOT-TRIGO-2026-006', '10000000-0000-0000-0000-000000000003', 'Trigo', 8.00, 'Silo 2', '2026-05-12', 'retenido', 10);
