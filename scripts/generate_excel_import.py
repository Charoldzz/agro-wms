from decimal import Decimal
from pathlib import Path
import re

import openpyxl

SOURCE = Path(r"C:\Users\Harold\Desktop\tagribol\AlmacenEjemplo2.xlsx")
OUTPUT = Path(__file__).resolve().parents[1] / "supabase" / "import_almacen_actual.sql"
DEFAULT_LOCATION = "Deposito Warnes Tagribol"

PACKAGE_RE = re.compile(
    r"(?:\d+\s*x\s*)?(\d+(?:[\.,]\d+)?)\s*(lts?|lt|ltr|litros?|l|kgs?|kg|grs?|gr|ml|cc)(?=$|[^a-z0-9])",
    re.IGNORECASE,
)
EX_LITERS_RE = re.compile(r"ex\s*(\d+)(?=$|[^a-z0-9])", re.IGNORECASE)


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


def parse_package_size(product, code):
    text = f"{product} {code}".replace("_", " ")
    matches = list(PACKAGE_RE.finditer(text))
    if matches:
        match = matches[-1]
        size = sql_number(match.group(1).replace(",", "."))
        unit = normalize_unit(match.group(2))
        return size, unit

    ex_match = EX_LITERS_RE.search(text)
    if ex_match:
        return sql_number(ex_match.group(1)), "lt"

    return "null", "null"


def normalize_unit(unit):
    value = unit.lower().replace(".", "")
    if value in {"lt", "lts", "ltr", "l", "litro", "litros"}:
        return "lt"
    if value in {"kg", "kgs"}:
        return "kg"
    if value in {"gr", "grs"}:
        return "gr"
    if value == "ml":
        return "ml"
    if value == "cc":
        return "cc"
    return value


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

        client = clean(row[index["nomb_alma"]]) or "Sin cliente"
        location = DEFAULT_LOCATION
        product = clean(row[index["nomb_cata"]]) or clean(row[index["codorigen"]])
        code = clean(row[index["codorigen"]]) or f"FILA-{row_number}"
        original_lot = clean(row[index["nrolote"]])
        package_size, package_unit = parse_package_size(product, code)

        lot_code = code
        if original_lot:
            lot_code = f"{lot_code}-LOTE-{original_lot}"

        product_detail = product
        if code and code not in product_detail:
            product_detail += f" | Cod: {code}"

        rows.append(
            (
                client,
                lot_code[:120],
                product_detail[:500],
                sql_number(stock),
                location[:200],
                package_size,
                package_unit,
            )
        )

    clients = sorted({row[0] for row in rows})
    lines = [
        "-- Import generado desde AlmacenEjemplo2.xlsx",
        f"-- Registros importados: {len(rows)} lotes con stock mayor a cero",
        "",
        "insert into public.clients (name, contact, notes)",
        "select v.name, v.contact, v.notes",
        "from (values",
        ",\n".join(
            f"  ({sql_quote(client)}, null, 'Importado desde Excel AlmacenEjemplo2.xlsx')"
            for client in clients
        ),
        ") as v(name, contact, notes)",
        "where not exists (select 1 from public.clients c where c.name = v.name);",
        "",
        "insert into public.lots (lot_code, client_id, product, current_quantity, package_size, package_unit, location, entry_date, status, low_stock_threshold)",
        "values",
    ]

    lot_values = []
    for client, lot_code, product, stock, location, package_size, package_unit in rows:
        unit_value = "null" if package_unit == "null" else sql_quote(package_unit)
        lot_values.append(
            "  ("
            f"{sql_quote(lot_code)}, "
            f"(select id from public.clients where name = {sql_quote(client)} limit 1), "
            f"{sql_quote(product)}, "
            f"{stock}, "
            f"{package_size}, "
            f"{unit_value}, "
            f"{sql_quote(location)}, "
            "current_date, "
            "'activo', "
            "5)"
        )

    lines.extend(
        [
            ",\n".join(lot_values),
            "on conflict (lot_code) do update set current_quantity = excluded.current_quantity, product = excluded.product, package_size = excluded.package_size, package_unit = excluded.package_unit, location = excluded.location, updated_at = now();",
            "",
        ]
    )

    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Archivo generado: {OUTPUT}")
    print(f"Clientes: {len(clients)}")
    print(f"Lotes con stock: {len(rows)}")


if __name__ == "__main__":
    main()
