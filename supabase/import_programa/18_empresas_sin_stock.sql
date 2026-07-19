-- ============================================================
-- 18 · EMPRESAS CLIENTE que hoy NO tienen stock
--
-- Son clientes reales que en algun momento tuvieron mercaderia (o que van a
-- traerla). Se cargan para que aparezcan en la lista de INGRESO.
--
-- Donde se ven y donde no (decision Harold 2026-07-19):
--   · Almacenes (inicio) -> SOLO las que tienen stock
--   · Ingreso            -> TODAS (puede llegar mercaderia de cualquiera)
--   · Salida             -> SOLO las que tienen algo para despachar
-- Ese filtrado lo hace la app; aca solo se cargan las fichas.
--
-- El codigo 23 se carga como SEMILLAS MONICA (nombre del Panel Stock
-- Independiente, el sistema oficial de almacenaje). En la otra base figura
-- como "UPL", pero UPL BOLIVIA SRL ya existe aparte con el codigo 54.
-- ============================================================
begin;

insert into public.clients (name, contact, inventory_source, product_code_prefix, solucion_codigo)
values
  ('TRIMERCO', null, 'stock_independiente', null, 18),
  ('ROTAM BOLIVIA', null, 'stock_independiente', null, 19),
  ('TECHIC', null, 'stock_independiente', null, 20),
  ('AGRO FORCE', null, 'stock_independiente', null, 22),
  ('SEMILLAS MONICA', null, 'stock_independiente', null, 23),
  ('CIAGRO S.A', null, 'stock_independiente', null, 25),
  ('FITOQUIM SRL', null, 'stock_independiente', null, 26),
  ('GABRIEL MICHELON (TECNOMYL)', null, 'stock_independiente', null, 29),
  ('NELSON HIROSHI SAKUMA (TECNOMY', null, 'stock_independiente', null, 30),
  ('PETRUS BUHLER', null, 'stock_independiente', null, 31),
  ('YAGUARU AGROPECUARIA', null, 'stock_independiente', null, 34),
  ('JUAN ALBERTO SUAREZ', null, 'stock_independiente', null, 36),
  ('JUAN RAMIRO CHOQUE', null, 'stock_independiente', null, 37),
  ('GRANORTE', null, 'stock_independiente', null, 38),
  ('JUAN ALBERTO FLORES', null, 'stock_independiente', null, 39),
  ('ALICORP', null, 'stock_independiente', null, 43),
  ('SYNGENTA', null, 'stock_independiente', null, 46),
  ('ALBAUGH', null, 'stock_independiente', null, 49),
  ('GRANODEST SRL', null, 'stock_independiente', null, 52),
  ('BRONCOS SRL', null, 'stock_independiente', null, 53)
on conflict do nothing;

commit;

-- ============================================================
-- VERIFICACION
-- ============================================================
select count(*) as empresas_totales from public.clients;   -- esperado 42

select
  count(*) filter (where existe_stock)      as con_stock,      -- esperado 22
  count(*) filter (where not existe_stock)  as sin_stock       -- esperado 20
from (
  select c.id, exists (
           select 1 from public.lots l
           where l.client_id = c.id and l.current_quantity > 0
         ) as existe_stock
  from public.clients c
) t;
