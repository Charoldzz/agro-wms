-- Agregar prefijo de codigo a clientes
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS product_code_prefix text;

-- Tabla de catalogo de productos
CREATE TABLE IF NOT EXISTS public.product_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  package_size numeric(12,2),
  package_unit text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_catalog_client_id_idx ON public.product_catalog(client_id);
CREATE INDEX IF NOT EXISTS product_catalog_code_idx ON public.product_catalog(code);

-- RLS
ALTER TABLE public.product_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados leen catalogo"
ON public.product_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "Administradores gestionan catalogo"
ON public.product_catalog FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'administrador'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'administrador'));
