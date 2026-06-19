import argparse
import csv
import json
import re
import unicodedata
import uuid
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zipfile import ZipFile


NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "todo-agricola-stock-independiente")
DEFAULT_LOCATION = "Deposito Warnes"
SOURCE_NAME = "stock_independiente"


def clean_text(value):
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()


def sql_text(value):
    if value is None:
        return "null"
    return "'" + clean_text(value).replace("'", "''") + "'"


def sql_json(value):
    return sql_text(json.dumps(value or {}, ensure_ascii=False, separators=(",", ":"))) + "::jsonb"


def sql_num(value):
    if value is None or value == "":
        return "null"
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return "null"
    normalized = format(number.normalize(), "f")
    return "0" if normalized == "-0" else normalized


def sql_date(value):
    parsed = parse_date(value)
    return "null" if not parsed else f"'{parsed}'::date"


def parse_date(value):
    text = clean_text(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text[:19] if "T" in text else text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def decimal_value(value):
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def stable_uuid(*parts):
    return str(uuid.uuid5(NAMESPACE, "|".join(clean_text(part) for part in parts)))


def load_from_zip(zip_path):
    with ZipFile(zip_path) as archive:
        names = archive.namelist()
        json_name = next(
            name for name in names
            if name.endswith("dist/Datos/inventario-independiente.json")
        )
        data = json.loads(archive.read(json_name).decode("utf-8-sig"))

        csv_data = {}
        for candidate in names:
            if candidate.endswith("dist/config/productos-medidas.csv"):
                csv_data["medidas"] = archive.read(candidate).decode("utf-8-sig")
            if candidate.endswith("dist/config/empresas-precios.csv"):
                csv_data["empresas"] = archive.read(candidate).decode("utf-8-sig")

    return data, csv_data


def load_from_path(source):
    source_path = Path(source)
    if source_path.suffix.lower() == ".zip":
        return load_from_zip(source_path)

    if source_path.is_file():
        return json.loads(source_path.read_text(encoding="utf-8-sig")), {}

    json_path = source_path / "dist" / "Datos" / "inventario-independiente.json"
    data = json.loads(json_path.read_text(encoding="utf-8-sig"))
    csv_data = {}
    medidas_path = source_path / "dist" / "config" / "productos-medidas.csv"
    empresas_path = source_path / "dist" / "config" / "empresas-precios.csv"
    if medidas_path.exists():
        csv_data["medidas"] = medidas_path.read_text(encoding="utf-8-sig")
    if empresas_path.exists():
        csv_data["empresas"] = empresas_path.read_text(encoding="utf-8-sig")
    return data, csv_data


def read_csv_text(text):
    if not text:
        return []
    first_line = text.splitlines()[0] if text.splitlines() else ""
    delimiter = ";" if first_line.count(";") > first_line.count(",") else ","
    return list(csv.DictReader(text.splitlines(), delimiter=delimiter))


def normalize_lookup_text(value):
    text = clean_text(value).upper()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^A-Z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_unit(unit):
    text = clean_text(unit).lower()
    if text in {"l", "lt", "lts", "litro", "litros"}:
        return "lt"
    if text in {"k", "kg", "kgs", "kilo", "kilos"}:
        return "kg"
    if text in {"g", "gr", "grs", "gramo", "gramos"}:
        return "gr"
    if text in {"ml", "mlt", "mlts", "mililitro", "mililitros"}:
        return "ml"
    return text or None


def extract_package(product_name):
    name = clean_text(product_name)
    patterns = [
        r"(?:x|X)\s*([0-9]+(?:[.,][0-9]+)?)\s*(lts?|litros?|lt)\b",
        r"(?:x|X)\s*([0-9]+(?:[.,][0-9]+)?)\s*(kgs?|kilos?|kg)\b",
        r"(?:x|X)\s*([0-9]+(?:[.,][0-9]+)?)\s*(grs?|gramos?|gr)\b",
        r"(?:x|X)\s*([0-9]+(?:[.,][0-9]+)?)\s*(mls?|mlts?|ml)\b",
        r"\b([0-9]+(?:[.,][0-9]+)?)\s*(lts?|litros?|lt)\b",
        r"\b([0-9]+(?:[.,][0-9]+)?)\s*(kgs?|kilos?|kg)\b",
        r"\b([0-9]+(?:[.,][0-9]+)?)\s*(grs?|gramos?|gr)\b",
        r"\b([0-9]+(?:[.,][0-9]+)?)\s*(mls?|mlts?|ml)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, name, flags=re.IGNORECASE)
        if match:
            size = decimal_value(match.group(1).replace(",", "."))
            unit = normalize_unit(match.group(2))
            if size > 0 and unit:
                return size, unit
    return None, None


def measure_product_key(row):
    return clean_text(
        row.get("ProductCode")
        or row.get("Codigo")
        or row.get("CodigoProducto")
        or row.get("Producto")
    )


def measure_name_key(row):
    return normalize_lookup_text(row.get("Producto") or row.get("Product") or row.get("Name"))


def pallet_units_from_measure(row):
    return decimal_value(
        row.get("CantidadPorPallet")
        or row.get("UnitsPerPallet")
        or row.get("PalletUnits")
        or row.get("EnvasesPorPallet")
    )


def stock_key(movement):
    return (
        clean_text(movement.get("ProductCode")),
        clean_text(movement.get("WarehouseCode")),
        clean_text(movement.get("Lot")),
        parse_date(movement.get("ExpiryDate")) or "",
    )


def is_real_warehouse(warehouse, stock_by_warehouse):
    name = clean_text(warehouse.get("Name")).upper()
    if not warehouse.get("IsActive", True):
        return False
    if name in {"ASD", "JULIO", "ANTONIO", "POLO", "POL"}:
        return False
    return stock_by_warehouse.get(clean_text(warehouse.get("Code")), Decimal("0")) > 0


def build_model(data, csv_data, include_all_warehouses=False):
    products = {
        clean_text(product.get("Code")): product
        for product in data.get("Products", [])
        if clean_text(product.get("Code"))
    }
    raw_warehouses = {
        clean_text(warehouse.get("Code")): warehouse
        for warehouse in data.get("Warehouses", [])
        if clean_text(warehouse.get("Code"))
    }

    product_measure_rows = {}
    product_measure_name_rows = {}
    for row in read_csv_text(csv_data.get("medidas")):
        product_key = measure_product_key(row)
        name_key = measure_name_key(row)
        if product_key:
            product_measure_rows[product_key] = row
        if name_key:
            product_measure_name_rows[name_key] = row

    stock = defaultdict(Decimal)
    incoming = defaultdict(Decimal)
    outgoing = defaultdict(Decimal)
    stock_by_warehouse = defaultdict(Decimal)
    first_entry_date = {}

    for movement in data.get("Movements", []):
        if movement.get("IsDeleted"):
            continue
        key = stock_key(movement)
        movement_type = clean_text(movement.get("Type")).upper()
        quantity = decimal_value(movement.get("Quantity"))
        if not key[0] or not key[1] or quantity <= 0:
            continue
        if movement_type == "INGRESO":
            stock[key] += quantity
            incoming[key] += quantity
            movement_date = parse_date(movement.get("Date"))
            if movement_date and key not in first_entry_date:
                first_entry_date[key] = movement_date
        elif movement_type == "SALIDA":
            stock[key] -= quantity
            outgoing[key] += quantity

    for key, quantity in stock.items():
        if quantity > 0:
            stock_by_warehouse[key[1]] += quantity

    warehouses = {
        code: warehouse
        for code, warehouse in raw_warehouses.items()
        if include_all_warehouses or is_real_warehouse(warehouse, stock_by_warehouse)
    }

    stock_rows = []
    for key, quantity in sorted(stock.items()):
        product_code, warehouse_code, lot_code, expiry_date = key
        if quantity <= 0 or warehouse_code not in warehouses:
            continue
        product = products.get(product_code, {})
        package_size, package_unit = extract_package(product.get("Name"))
        product_name_key = normalize_lookup_text(product.get("Name"))
        measure = product_measure_rows.get(product_code) or product_measure_name_rows.get(product_name_key)
        pallet_units_per_pallet = None
        if measure:
            package_size = package_size or decimal_value(measure.get("UnitSize"))
            package_unit = package_unit or normalize_unit(measure.get("UnitName"))
            pallet_units = pallet_units_from_measure(measure)
            pallet_units_per_pallet = pallet_units if pallet_units > 0 else None
        mirror_id = f"{SOURCE_NAME}|{warehouse_code}|{product_code}|{lot_code}|{expiry_date}"
        stock_rows.append({
            "id": stable_uuid(mirror_id),
            "mirror_id": mirror_id,
            "product_code": product_code,
            "warehouse_code": warehouse_code,
            "lot_code": lot_code or f"SIN-LOTE-{product_code}",
            "app_lot_code": f"SOL-{product_code}-{warehouse_code}-{lot_code or 'SINLOTE'}-{expiry_date or 'SINVEN'}",
            "expiry_date": expiry_date,
            "quantity": quantity,
            "incoming": incoming[key],
            "outgoing": outgoing[key],
            "entry_date": first_entry_date.get(key),
            "product": product,
            "warehouse": warehouses[warehouse_code],
            "package_size": package_size,
            "package_unit": package_unit,
            "pallet_units_per_pallet": pallet_units_per_pallet,
        })

    return {
        "products": products,
        "warehouses": warehouses,
        "stock_rows": stock_rows,
        "source_last_movement_id": data.get("LastMovementId"),
        "source_last_note_number": data.get("LastNoteNumber"),
    }


def write_prepare_sql(output_dir):
    prepare_path = output_dir / "00_prepare_stock_independiente.sql"
    prepare_path.write_text("""-- Preparacion para importar Programa Stock Independiente.
-- Ejecutar una vez antes de las partes de importacion.

create extension if not exists pgcrypto;

create table if not exists public.solucion_clients (
  solucion_codigo bigint primary key,
  name text not null,
  phone text,
  email text,
  contact text,
  status numeric,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_products (
  product_code text primary key,
  barcode text,
  name text not null,
  unit_code numeric,
  min_stock numeric,
  inactive boolean not null default false,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_warehouses (
  warehouse_code bigint primary key,
  name text not null,
  short_name text,
  responsible text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_stock (
  mirror_id text primary key,
  product_code text not null,
  warehouse_code bigint,
  lot_code text,
  expiry_date date,
  current_quantity numeric,
  incoming_quantity numeric,
  outgoing_quantity numeric,
  reserved_quantity numeric,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_operation_headers (
  mirror_id text primary key,
  operation_type text not null,
  document_number bigint not null,
  document_date date,
  client_or_provider_code bigint,
  warehouse_code bigint,
  origin_warehouse_code bigint,
  destination_warehouse_code bigint,
  concept text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create table if not exists public.solucion_operation_lines (
  mirror_id text primary key,
  operation_type text not null,
  document_number bigint not null,
  line_number bigint not null,
  product_code text,
  quantity numeric,
  lot_code text,
  expiry_date date,
  warehouse_code bigint,
  product_name text,
  raw_data jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

alter table public.clients
add column if not exists solucion_codigo bigint,
add column if not exists inventory_source text not null default 'app',
add column if not exists source_key text,
add column if not exists raw_data jsonb not null default '{}'::jsonb;

drop index if exists public.clients_source_key_key;
create unique index clients_source_key_key
on public.clients(source_key)
;

alter table public.lots
add column if not exists inventory_source text not null default 'app',
add column if not exists solucion_mirror_id text,
add column if not exists solucion_product_code text,
add column if not exists solucion_warehouse_code bigint,
add column if not exists pallet_units_per_pallet numeric(12, 2),
add column if not exists solucion_synced_at timestamptz,
add column if not exists qr_token text;

drop index if exists public.lots_solucion_mirror_id_key;
create unique index lots_solucion_mirror_id_key
on public.lots(solucion_mirror_id)
;

create unique index if not exists lots_qr_token_key
on public.lots(qr_token)
where qr_token is not null;

create index if not exists lots_inventory_source_idx
on public.lots(inventory_source);

create index if not exists clients_inventory_source_idx
on public.clients(inventory_source);
""", encoding="utf-8")
    return prepare_path


def values_statement(table, columns, rows, conflict_clause, chunk_size=300):
    statements = []
    for start in range(0, len(rows), chunk_size):
        chunk = rows[start:start + chunk_size]
        if not chunk:
            continue
        body = ",\n".join("  (" + ", ".join(row) + ")" for row in chunk)
        statements.append(
            f"insert into {table} ({', '.join(columns)})\nvalues\n{body}\n{conflict_clause};"
        )
    return statements


def build_import_sql(model):
    statements = []

    warehouses = []
    clients = []
    for code, warehouse in sorted(model["warehouses"].items(), key=lambda item: int(item[0])):
        name = clean_text(warehouse.get("Name"))
        raw = {"source": SOURCE_NAME, **warehouse}
        warehouses.append([
            sql_num(code),
            sql_text(name),
            "null",
            "null",
            sql_json(raw),
            "now()",
        ])
        clients.append([
            sql_text(stable_uuid("client", code)),
            sql_text(name),
            "null",
            sql_text("Cliente de almacen importado desde Stock Independiente."),
            sql_text(f"stock_independiente:warehouse:{code}"),
            sql_num(code),
            sql_text(SOURCE_NAME),
            sql_json(raw),
        ])

    product_rows = []
    for code, product in sorted(model["products"].items()):
        if not code:
            continue
        product_rows.append([
            sql_text(code),
            sql_text(product.get("Barcode")),
            sql_text(product.get("Name")),
            sql_num(product.get("UnitCode")),
            sql_num(product.get("MinStock")),
            "true" if product.get("IsInactive") else "false",
            sql_json({"source": SOURCE_NAME, **product}),
            "now()",
        ])

    stock_rows = []
    lot_rows = []
    for row in model["stock_rows"]:
        product = row["product"]
        warehouse = row["warehouse"]
        product_name = clean_text(product.get("Name")) or row["product_code"]
        warehouse_code = row["warehouse_code"]
        raw = {
            "source": SOURCE_NAME,
            "product_code": row["product_code"],
            "warehouse_code": warehouse_code,
            "warehouse_name": warehouse.get("Name"),
            "lot_code": row["lot_code"],
            "expiry_date": row["expiry_date"],
            "incoming_quantity": str(row["incoming"]),
            "outgoing_quantity": str(row["outgoing"]),
            "current_quantity": str(row["quantity"]),
            "pallet_units_per_pallet": str(row["pallet_units_per_pallet"] or ""),
        }
        stock_rows.append([
            sql_text(row["mirror_id"]),
            sql_text(row["product_code"]),
            sql_num(warehouse_code),
            sql_text(row["lot_code"]),
            sql_date(row["expiry_date"]),
            sql_num(row["quantity"]),
            sql_num(row["incoming"]),
            sql_num(row["outgoing"]),
            "0",
            sql_json(raw),
            "now()",
        ])
        lot_rows.append([
            sql_text(row["id"]),
            sql_text(row["app_lot_code"]),
            sql_text(stable_uuid("client", warehouse_code)),
            sql_text(product_name),
            sql_num(row["quantity"]),
            "0",
            "0",
            "0",
            sql_num(row["package_size"]),
            sql_text(row["package_unit"]),
            sql_num(row["pallet_units_per_pallet"]),
            sql_text(DEFAULT_LOCATION),
            sql_date(row["entry_date"]) if row["entry_date"] else "current_date",
            sql_date(row["expiry_date"]),
            "'activo'::public.lot_status",
            "null",
            "5",
            sql_text(SOURCE_NAME),
            sql_text(row["mirror_id"]),
            sql_text(row["product_code"]),
            sql_num(warehouse_code),
            "now()",
            "coalesce((select qr_token from public.lots where solucion_mirror_id = " + sql_text(row["mirror_id"]) + "), encode(gen_random_bytes(24), 'hex'))",
        ])

    statements.extend(values_statement(
        "public.solucion_warehouses",
        ["warehouse_code", "name", "short_name", "responsible", "raw_data", "synced_at"],
        warehouses,
        "on conflict (warehouse_code) do update set name = excluded.name, raw_data = excluded.raw_data, synced_at = now()",
    ))
    statements.extend(values_statement(
        "public.solucion_clients",
        ["solucion_codigo", "name", "phone", "email", "contact", "status", "raw_data", "synced_at"],
        [[row[0], row[1], "null", "null", "null", "1", row[4], "now()"] for row in warehouses],
        "on conflict (solucion_codigo) do update set name = excluded.name, raw_data = excluded.raw_data, synced_at = now()",
    ))
    statements.extend(values_statement(
        "public.clients",
        ["id", "name", "contact", "notes", "source_key", "solucion_codigo", "inventory_source", "raw_data"],
        clients,
        "on conflict (source_key) do update set name = excluded.name, solucion_codigo = excluded.solucion_codigo, inventory_source = excluded.inventory_source, raw_data = excluded.raw_data",
    ))
    statements.extend(values_statement(
        "public.solucion_products",
        ["product_code", "barcode", "name", "unit_code", "min_stock", "inactive", "raw_data", "synced_at"],
        product_rows,
        "on conflict (product_code) do update set name = excluded.name, barcode = excluded.barcode, unit_code = excluded.unit_code, min_stock = excluded.min_stock, inactive = excluded.inactive, raw_data = excluded.raw_data, synced_at = now()",
    ))
    statements.extend(values_statement(
        "public.solucion_stock",
        ["mirror_id", "product_code", "warehouse_code", "lot_code", "expiry_date", "current_quantity", "incoming_quantity", "outgoing_quantity", "reserved_quantity", "raw_data", "synced_at"],
        stock_rows,
        "on conflict (mirror_id) do update set current_quantity = excluded.current_quantity, incoming_quantity = excluded.incoming_quantity, outgoing_quantity = excluded.outgoing_quantity, raw_data = excluded.raw_data, synced_at = now()",
    ))
    statements.extend(values_statement(
        "public.lots",
        [
            "id", "lot_code", "client_id", "product", "current_quantity",
            "entry_boxes", "entry_units_per_box", "entry_loose_units",
            "package_size", "package_unit", "pallet_units_per_pallet", "location", "entry_date", "expiry_date",
            "status", "photo_url", "low_stock_threshold", "inventory_source",
            "solucion_mirror_id", "solucion_product_code", "solucion_warehouse_code",
            "solucion_synced_at", "qr_token",
        ],
        lot_rows,
        """on conflict (solucion_mirror_id) do update set
  lot_code = excluded.lot_code,
  client_id = excluded.client_id,
  product = excluded.product,
  current_quantity = excluded.current_quantity,
  package_size = excluded.package_size,
  package_unit = excluded.package_unit,
  pallet_units_per_pallet = excluded.pallet_units_per_pallet,
  location = excluded.location,
  entry_date = excluded.entry_date,
  expiry_date = excluded.expiry_date,
  status = excluded.status,
  inventory_source = excluded.inventory_source,
  solucion_product_code = excluded.solucion_product_code,
  solucion_warehouse_code = excluded.solucion_warehouse_code,
  solucion_synced_at = now(),
  qr_token = coalesce(public.lots.qr_token, excluded.qr_token)""",
    ))

    statements.append("""select
  (select count(*) from public.clients where inventory_source = 'stock_independiente') as clientes_stock_independiente,
  (select count(*) from public.lots where inventory_source = 'stock_independiente') as lotes_stock_independiente,
  (select coalesce(sum(current_quantity), 0) from public.lots where inventory_source = 'stock_independiente') as envases_stock_independiente,
  (select count(*) from public.solucion_products) as productos_espejo,
  (select count(*) from public.solucion_stock) as stock_espejo;""")
    return statements


def split_statements(statements, max_bytes):
    chunks = []
    current = []
    current_size = 0
    for statement in statements:
        text = statement.strip() + "\n\n"
        size = len(text.encode("utf-8"))
        if current and current_size + size > max_bytes:
            chunks.append("".join(current).strip() + "\n")
            current = []
            current_size = 0
        current.append(text)
        current_size += size
    if current:
        chunks.append("".join(current).strip() + "\n")
    return chunks


def main():
    parser = argparse.ArgumentParser(description="Genera SQL limpio desde Programa Stock Independiente.")
    parser.add_argument("--source", required=True, help="ZIP, carpeta del programa o inventario-independiente.json.")
    parser.add_argument("--output-dir", default="tmp/stock_independiente_import", help="Carpeta de salida.")
    parser.add_argument("--max-mb", type=float, default=1.2, help="Tamano maximo aproximado por parte.")
    parser.add_argument("--include-all-warehouses", action="store_true", help="Incluye almacenes sin stock u obvios de prueba.")
    args = parser.parse_args()

    data, csv_data = load_from_path(args.source)
    model = build_model(data, csv_data, include_all_warehouses=args.include_all_warehouses)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for old_file in output_dir.glob("*.sql"):
        old_file.unlink()

    prepare_path = write_prepare_sql(output_dir)
    statements = build_import_sql(model)
    chunks = split_statements(statements, int(args.max_mb * 1024 * 1024))

    for position, chunk in enumerate(chunks, start=1):
        path = output_dir / f"stock_independiente_import_part_{position:02d}.sql"
        path.write_text(chunk, encoding="utf-8")

    summary = {
        "source": SOURCE_NAME,
        "source_last_movement_id": model["source_last_movement_id"],
        "source_last_note_number": model["source_last_note_number"],
        "warehouses_as_clients": len(model["warehouses"]),
        "products": len(model["products"]),
        "active_stock_lots": len(model["stock_rows"]),
        "total_packages": str(sum(row["quantity"] for row in model["stock_rows"])),
        "total_billing_pallets": str(sum((row["quantity"] / row["pallet_units_per_pallet"]) for row in model["stock_rows"] if row["pallet_units_per_pallet"])),
        "stock_lots_without_pallet_rule": sum(1 for row in model["stock_rows"] if not row["pallet_units_per_pallet"]),
        "prepare_sql": str(prepare_path),
        "parts": len(chunks),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
