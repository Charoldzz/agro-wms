-- ============================================================
-- 02 · EMPRESAS (almacenes del programa con stock)
-- ============================================================
begin;

insert into public.clients (name, contact, inventory_source, product_code_prefix, solucion_codigo) values
  ('ALMACEN G.A.T BOLIVIA', null, 'stock_independiente', 'GATB', 17),
  ('AGRO PARCEL', null, 'stock_independiente', 'APAR', 21),
  ('TECNOMYL S.A', null, 'stock_independiente', 'TCML', 24),
  ('TOTAL AGRO S.A', null, 'stock_independiente', 'TOAG', 27),
  ('AGROPECUARIA GUANANDI SRL (TEC', null, 'stock_independiente', 'AGUA', 28),
  ('AUBREY REINALDO VIRICA', null, 'stock_independiente', 'AURV', 32),
  ('TECNOMYL (REPROCESO)', null, 'stock_independiente', 'TCML', 33),
  ('DENIS BARBIERI', null, 'stock_independiente', 'DEBA', 35),
  ('TOTAL PEC SRL', null, 'stock_independiente', 'TOPE', 40),
  ('ADILSON SABEC PERES', null, 'stock_independiente', 'ADSP', 41),
  ('AGRO NEULAND DEL SUR SRL', null, 'stock_independiente', 'ANEU', 42),
  ('MAXIAGRO SRL', null, 'stock_independiente', 'MAXI', 44),
  ('FOLCOL S.A.S', null, 'stock_independiente', 'FOLC', 45),
  ('DISAN SRL', null, 'stock_independiente', 'DISA', 47),
  ('ZENTTA-BIO SRL', null, 'stock_independiente', 'ZEBI', 48),
  ('AGRICOLA RIO VICTORIA SRL', null, 'stock_independiente', 'ARIO', 50),
  ('SOGIMA SRL', null, 'stock_independiente', 'SOGI', 51),
  ('UPL BOLIVIA SRL', null, 'stock_independiente', 'UPLB', 54),
  ('AGROCALY SRL', null, 'stock_independiente', 'AGRO', 55),
  ('JACOBO MARTENS FRIESEN', null, 'stock_independiente', 'JAMF', 56),
  ('DAVID WIEBE DYCK', null, 'stock_independiente', 'DAWD', 57),
  ('LA BENDECIDA SRL', null, 'stock_independiente', 'BEND', 58);

commit;

select count(*) as empresas_importadas from public.clients;
