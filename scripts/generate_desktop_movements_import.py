# Genera SQL de importación del historial de movimientos del programa de
# escritorio (inventario-independiente.json → tabla desktop_movements).
#
# Uso:
#   python scripts/generate_desktop_movements_import.py "RUTA\a\inventario-independiente.json"
#
# Salida: tmp/desktop_movements_import/part_01.sql, part_02.sql, ...
# Correr los archivos en orden en el SQL Editor de Supabase
# (después de supabase/desktop_movements_migration.sql).

import json
import os
import sys

BATCH_ROWS = 500
ROWS_PER_FILE = 1500

COLUMNS = [
    'id', 'note_number', 'type', 'date', 'product_code', 'client_prefix',
    'product_name', 'lot', 'expiry_date', 'quantity', 'concept',
    'dispatch_company', 'contact_person', 'transporter', 'plate',
    'observations', 'package_boxes', 'package_units', 'package_gallons',
    'package_bidones', 'package_drums', 'package_pallets', 'created_at',
]


def sql_text(value):
    if value is None:
        return 'NULL'
    text = str(value).strip()
    if not text:
        return 'NULL'
    return "'" + text.replace("'", "''") + "'"


def sql_number(value):
    if value is None or value == '':
        return 'NULL'
    return str(value)


def sql_date(value):
    if not value:
        return 'NULL'
    return "'" + str(value) + "'"


def main():
    if len(sys.argv) < 2:
        print('Falta la ruta del inventario-independiente.json')
        sys.exit(1)

    source = sys.argv[1]
    with open(source, encoding='utf-8-sig') as handle:
        data = json.load(handle)

    products = {p['Code']: p.get('Name', '') for p in data.get('Products', [])}
    movements = [m for m in data.get('Movements', []) if not m.get('IsDeleted')]
    movements.sort(key=lambda m: m.get('Id', 0))
    print(f'Movimientos activos: {len(movements)}')

    out_dir = os.path.join(os.path.dirname(__file__), '..', 'tmp', 'desktop_movements_import')
    os.makedirs(out_dir, exist_ok=True)

    rows = []
    for m in movements:
        code = m.get('ProductCode') or ''
        prefix = code.split('-')[0] if '-' in code else code
        expiry = m.get('ExpiryDate')
        expiry_day = expiry[:10] if expiry else None
        rows.append('(' + ', '.join([
            str(m.get('Id')),
            sql_text(m.get('NoteNumber')),
            sql_text(m.get('Type')),
            sql_date(m.get('Date')),
            sql_text(code),
            sql_text(prefix),
            sql_text(products.get(code, '')),
            sql_text(m.get('Lot')),
            sql_date(expiry_day),
            sql_number(m.get('Quantity')),
            sql_text(m.get('Concept')),
            sql_text(m.get('DispatchCompany')),
            sql_text(m.get('ContactPerson')),
            sql_text(m.get('Transporter')),
            sql_text(m.get('Plate')),
            sql_text(m.get('Observations')),
            sql_text(m.get('PackageBoxes')),
            sql_text(m.get('PackageUnits')),
            sql_text(m.get('PackageGallons')),
            sql_text(m.get('PackageBidones')),
            sql_text(m.get('PackageDrums')),
            sql_text(m.get('PackagePallets')),
            sql_date(m.get('CreatedAt')),
        ]) + ')')

    file_count = 0
    for file_start in range(0, len(rows), ROWS_PER_FILE):
        file_rows = rows[file_start:file_start + ROWS_PER_FILE]
        file_count += 1
        path = os.path.join(out_dir, f'part_{file_count:02d}.sql')
        with open(path, 'w', encoding='utf-8') as out:
            if file_count == 1:
                out.write('-- Limpia la importación anterior (solo en la primera parte)\n')
                out.write('TRUNCATE public.desktop_movements;\n\n')
            for batch_start in range(0, len(file_rows), BATCH_ROWS):
                batch = file_rows[batch_start:batch_start + BATCH_ROWS]
                out.write(f'INSERT INTO public.desktop_movements ({", ".join(COLUMNS)}) VALUES\n')
                out.write(',\n'.join(batch))
                out.write('\nON CONFLICT (id) DO NOTHING;\n\n')
        print(f'{path} — {len(file_rows)} filas')

    print(f'Listo: {file_count} archivo(s) en {out_dir}')
    print('Correr en orden en el SQL Editor de Supabase.')


if __name__ == '__main__':
    main()
