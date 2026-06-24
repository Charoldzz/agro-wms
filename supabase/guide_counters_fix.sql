-- Fix: Semilla de contadores basada en cantidad real de operaciones por tipo
-- Ejecutar este script DESPUÉS de guide_number_sal_ing.sql

UPDATE public.warehouse_operation_counters
SET next_number = (
  SELECT count(*) + 1
  FROM public.warehouse_operations
  WHERE type = 'despacho'
)
WHERE counter_name = 'guide_sal';

UPDATE public.warehouse_operation_counters
SET next_number = (
  SELECT count(*) + 1
  FROM public.warehouse_operations
  WHERE type = 'ingreso'
)
WHERE counter_name = 'guide_ing';

-- Verificar los valores resultantes:
SELECT counter_name, next_number FROM public.warehouse_operation_counters
WHERE counter_name IN ('guide_sal', 'guide_ing');
