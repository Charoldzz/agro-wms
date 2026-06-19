-- Reglas de pallets para cobranzas.
-- Este campo guarda cuantos envases/unidades comerciales forman 1 pallet
-- segun dist/config/productos-medidas.csv del Programa Stock Independiente.

alter table public.lots
add column if not exists pallet_units_per_pallet numeric(12, 2)
check (pallet_units_per_pallet is null or pallet_units_per_pallet > 0);

create index if not exists lots_pallet_units_per_pallet_idx
on public.lots(pallet_units_per_pallet)
where pallet_units_per_pallet is not null;
