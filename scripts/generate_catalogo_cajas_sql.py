# Genera el SQL de carga del conteo de cajas (tmp/conteo_transcripcion.json)
# Salida: tmp/carga_conteo_cajas.sql — correr una vez en Supabase SQL Editor.
import json
import os

BASE = os.path.join(os.path.dirname(__file__), '..')
with open(os.path.join(BASE, 'tmp', 'conteo_transcripcion.json'), encoding='utf-8') as f:
    data = json.load(f)

# Correcciones de nombre confirmadas por Harold (2026-07-10)
# EMBATE corregido: es 1 por caja (no 7)
cajas = dict(data['cajas'])
cajas['EMBATE X 10 Kgs.'] = 1
cajas['STARFIX x 3 Lts.'] = 4


def esc(text):
    return text.replace("'", "''")


lines = [
    '-- Carga del conteo de cajas y correcciones de nombres (2026-07-10)',
    '-- Generado desde tmp/conteo_transcripcion.json',
    '',
    '-- ============ 1. CORRECCIONES DE NOMBRE ============',
    "-- OJO: corregir tambien en el PROGRAMA de escritorio para que la",
    "-- sincronizacion futura no vuelva a traer los nombres mal.",
    "update public.lots set product = replace(product, 'CLEHOSOL', 'CLETOSOL') where product ilike '%CLEHOSOL%';",
    "update public.desktop_movements set product_name = replace(product_name, 'CLEHOSOL', 'CLETOSOL') where product_name ilike '%CLEHOSOL%';",
    "update public.product_catalog set name = replace(name, 'CLEHOSOL', 'CLETOSOL') where name ilike '%CLEHOSOL%';",
    "update public.lots set product = replace(product, 'CALCIBO x', 'CALCIBOR x') where product ilike 'CALCIBO x%';",
    "update public.desktop_movements set product_name = replace(product_name, 'CALCIBO x', 'CALCIBOR x') where product_name ilike 'CALCIBO x%';",
    "update public.product_catalog set name = replace(name, 'CALCIBO x', 'CALCIBOR x') where name ilike 'CALCIBO x%';",
    '',
    '-- ============ 2. UNIDADES POR CAJA ============',
]

for name, upb in sorted(cajas.items()):
    # aplicar el nombre corregido si corresponde
    fixed = name.replace('CLEHOSOL', 'CLETOSOL').replace('CALCIBO x', 'CALCIBOR x')
    n = esc(fixed)
    lines += [
        f"-- {fixed} = {upb}/caja",
        "insert into public.product_catalog (client_id, code, name, package_size, package_unit)",
        "select distinct on (l.client_id) l.client_id, l.solucion_product_code, l.product, l.package_size, l.package_unit",
        "from public.lots l",
        f"where upper(l.product) = upper('{n}')",
        "  and l.inventory_source = 'stock_independiente'",
        "  and coalesce(l.solucion_product_code, '') <> ''",
        "  and not exists (select 1 from public.product_catalog pc where pc.client_id = l.client_id and upper(pc.name) = upper(l.product))",
        "on conflict (code) do nothing;",
        f"update public.product_catalog set units_per_box = {upb} where upper(name) = upper('{n}');",
        '',
    ]

lines += [
    '-- ============ 3. VERIFICACION ============',
    'select count(*) as productos_con_caja from public.product_catalog',
    'where units_per_box is not null and units_per_box > 0;',
]

out = os.path.join(BASE, 'tmp', 'carga_conteo_cajas.sql')
with open(out, 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))
print(f'Generado: {out} — {len(cajas)} productos')
