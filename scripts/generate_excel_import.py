from decimal import Decimal
from pathlib import Path
import re

import openpyxl

SOURCE = Path(r"C:\Users\Harold\Desktop\tagribol\AlmacenEJEMPLO.xlsx")
OUTPUT = Path(__file__).resolve().parents[1] / "supabase" / "import_almacen_ejemplo.sql"
DEFAULT_LOCATION = "Deposito Warnes Tagribol"


def clean(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def sql_quote(value):
    return "'" + clean(value).replace("'", "''") + "'"


def sql_number(value):
    try:
        return str(Decimal(str(value or 0)).quantize(Decimal("0.01")))
    except Exception:
        return "0.00"


def main():
    workbook = openpyxl.load_workbook(SOURCE, data_only=True)
    sheet = workbook["Almacen"]
    headers = [cell.value for cell in sheet[1]]
    index = {header: position for position, header in enumerate(headers)}

    rows = []
    for row_number, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
        stock = float(row[index["saldf_fin"]] or 0)
        if stock <= 0:
            continue

        client = clean(row[index["nomb_fami"]]) or clean(row[index["nomb_alma"]]) or "Sin cliente"
        location = DEFAULT_LOCATION
        product = clean(row[index["nomb_cata"]]) or clean(row[index["codorigen"]]) or clean(row[index["codigo"]])
        code = clean(row[index["codorigen"]]) or clean(row[index["codigo"]]) or f"FILA-{row_number}"
        original_lot = clean(row[index["nrolote"]])

        lot_code = f"EXCEL-{row_number}-{code}"
        if original_lot:
            lot_code = f"{lot_code}-LOTE-{original_lot}"

        product_detail = product
        group = clean(row[index["nomb_grup"]])
        subgroup = clean(row[index["nomb_subg"]])
        if code and code not in product_detail:
            product_detail += f" | Cod: {code}"
        if group:
            product_detail += f" | Grupo: {group}"
        if subgroup:
            product_detail += f" | Subgrupo: {subgroup}"

        rows.append(
            (
                client,
                lot_code[:120],
                product_detail[:500],
                sql_number(stock),
                location[:200],
            )
        )

    clients = sorted({row[0] for row in rows})
    lines = [
        "-- Import generado desde AlmacenEJEMPLO.xlsx",
        f"-- Registros importados: {len(rows)} lotes con stock mayor a cero",
        "",
        "insert into public.clients (name, contact, notes)",
        "select v.name, v.contact, v.notes",
        "from (values",
        ",\n".join(
            f"  ({sql_quote(client)}, null, 'Importado desde Excel AlmacenEJEMPLO.xlsx')"
            for client in clients
        ),
        ") as v(name, contact, notes)",
        "where not exists (select 1 from public.clients c where c.name = v.name);",
        "",
        "insert into public.lots (lot_code, client_id, product, current_quantity, location, entry_date, status, low_stock_threshold)",
        "values",
    ]

    lot_values = []
    for client, lot_code, product, stock, location in rows:
        lot_values.append(
            "  ("
            f"{sql_quote(lot_code)}, "
            f"(select id from public.clients where name = {sql_quote(client)} limit 1), "
            f"{sql_quote(product)}, "
            f"{stock}, "
            f"{sql_quote(location)}, "
            "current_date, "
            "'activo', "
            "5)"
        )

    lines.extend(
        [
            ",\n".join(lot_values),
            "on conflict (lot_code) do update set current_quantity = excluded.current_quantity, product = excluded.product, location = excluded.location, updated_at = now();",
            "",
        ]
    )

    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Archivo generado: {OUTPUT}")
    print(f"Clientes: {len(clients)}")
    print(f"Lotes con stock: {len(rows)}")


if __name__ == "__main__":
    main()
