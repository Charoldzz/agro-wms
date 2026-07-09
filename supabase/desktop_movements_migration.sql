-- Historial de movimientos del programa de escritorio (Panel Stock Independiente)
-- Tabla espejo de solo lectura: se carga por importación, la web no escribe aquí.
-- Correr UNA VEZ en Supabase SQL Editor, antes de los archivos de importación.

CREATE TABLE IF NOT EXISTS public.desktop_movements (
  id integer PRIMARY KEY,
  note_number text,
  type text NOT NULL,
  date timestamptz,
  product_code text,
  client_prefix text,
  product_name text,
  lot text,
  expiry_date date,
  quantity numeric(14,2),
  concept text,
  dispatch_company text,
  contact_person text,
  transporter text,
  plate text,
  observations text,
  package_boxes text,
  package_units text,
  package_gallons text,
  package_bidones text,
  package_drums text,
  package_pallets text,
  created_at timestamptz
);

CREATE INDEX IF NOT EXISTS desktop_movements_date_idx ON public.desktop_movements(date DESC);
CREATE INDEX IF NOT EXISTS desktop_movements_type_idx ON public.desktop_movements(type);
CREATE INDEX IF NOT EXISTS desktop_movements_prefix_idx ON public.desktop_movements(client_prefix);

ALTER TABLE public.desktop_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Operadores y admins leen historial desktop" ON public.desktop_movements;
CREATE POLICY "Operadores y admins leen historial desktop"
ON public.desktop_movements FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.id = auth.uid() AND p.role IN ('administrador', 'operador')
));

DROP POLICY IF EXISTS "Administradores gestionan historial desktop" ON public.desktop_movements;
CREATE POLICY "Administradores gestionan historial desktop"
ON public.desktop_movements FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'administrador'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'administrador'));
