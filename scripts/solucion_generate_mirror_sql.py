import argparse
import json
import struct
from pathlib import Path


TABLE_FILES = {
    "clients": "CLIENTE.DBF",
    "products": "CATALOGO.dbf",
    "warehouses": "ALMACEN.DBF",
    "stock": "STOCK.DBF",
    "entry_headers": "INGRECAB.dbf",
    "entry_lines": "INGREDET.DBF",
    "dispatch_headers": "SALIDCAB.dbf",
    "dispatch_lines": "SALIDDET.dbf",
    "transfer_headers": "TRASPCAB.dbf",
    "transfer_lines": "TRASPDET.dbf",
    "adjustment_headers": "AJUSTCAB.DBF",
    "adjustment_lines": "AJUSTDET.DBF",
}


def decode_text(raw):
    for encoding in ("utf-8", "cp1252", "latin1"):
        try:
            return raw.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return raw.decode("latin1", "replace").strip()


def read_dbf_schema(path):
    with path.open("rb") as file:
        header = file.read(32)
        if len(header) < 32:
            raise ValueError(f"DBF invalido o vacio: {path}")

        records = struct.unpack("<I", header[4:8])[0]
        header_length = struct.unpack("<H", header[8:10])[0]
        record_length = struct.unpack("<H", header[10:12])[0]
        fields = []
        offset = 1

        while True:
            field = file.read(32)
            if not field or field[0] == 0x0D:
                break
            name = decode_text(field[:11].split(b"\x00", 1)[0])
            field_type = chr(field[11])
            length = field[16]
            decimals = field[17]
            fields.append({
                "name": name,
                "type": field_type,
                "length": length,
                "decimals": decimals,
                "offset": offset,
            })
            offset += length

    return {
        "records": records,
        "header_length": header_length,
        "record_length": record_length,
        "fields": fields,
    }


def convert_value(raw, field_type):
    value = decode_text(raw)
    if not value:
        return None
    if field_type in {"N", "F"}:
        try:
            return int(value) if "." not in value else float(value)
        except ValueError:
            return value
    if field_type == "D":
        if len(value) == 8 and value != "00000000":
            return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
        return None
    if field_type == "L":
        return value.upper() in {"T", "Y", "S"}
    return value


def read_dbf_rows(path):
    schema = read_dbf_schema(path)
    rows = []

    with path.open("rb") as file:
        file.seek(schema["header_length"])
        for _ in range(schema["records"]):
            record = file.read(schema["record_length"])
            if not record or record[:1] == b"*":
                continue
            row = {}
            for field in schema["fields"]:
                raw = record[field["offset"]:field["offset"] + field["length"]]
                row[field["name"].upper()] = convert_value(raw, field["type"])
            rows.append(row)

    return rows


def clean_text(value):
    if value is None:
        return None
    text = "".join(char for char in str(value) if char >= " " or char in "\n\r\t").strip()
    return text or None


def clean_json_value(value):
    if isinstance(value, dict):
        return {key: clean_json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clean_json_value(item) for item in value]
    if isinstance(value, str):
        return "".join(char for char in value if char >= " " or char in "\n\r\t")
    return value


def raw_json(row):
    return json.dumps(clean_json_value(row), ensure_ascii=False, default=str)


def to_int(value):
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def to_number(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sql_literal(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def json_literal(value):
    return sql_literal(json.dumps(value, ensure_ascii=False, default=str))


def row_sql(values):
    return "(" + ", ".join(sql_literal(value) for value in values) + ")"


def upsert_block(table, columns, rows, conflict_columns, update_columns, chunk_size=300):
    if not rows:
        return ""

    statements = []
    conflict = ", ".join(conflict_columns)
    updates = ", ".join(f"{column} = excluded.{column}" for column in update_columns)

    for index in range(0, len(rows), chunk_size):
        chunk = rows[index:index + chunk_size]
        values = ",\n  ".join(row_sql(row) for row in chunk)
        statements.append(
            f"insert into {table} ({', '.join(columns)})\n"
            f"values\n  {values}\n"
            f"on conflict ({conflict}) do update set\n  {updates};"
        )
    return "\n\n".join(statements)


def load_tables(solucion_path):
    tables = {}
    for key, file_name in TABLE_FILES.items():
        path = solucion_path / file_name
        tables[key] = read_dbf_rows(path) if path.exists() else []
    return tables


def build_clients(rows):
    output = []
    for row in rows:
        code = to_int(row.get("CODIGO"))
        name = clean_text(row.get("NOMBRE"))
        if code is None or not name:
            continue
        output.append([
            code,
            name,
            clean_text(row.get("TELEFONOS")),
            clean_text(row.get("EMAIL")),
            clean_text(row.get("CONTACTO")),
            to_number(row.get("ESTADO")),
            raw_json(row),
        ])
    return output


def build_products(rows):
    output = []
    for row in rows:
        code = clean_text(row.get("CODIGO"))
        name = clean_text(row.get("NOMBRE"))
        if not code or not name:
            continue
        output.append([
            code,
            clean_text(row.get("CODBAR")),
            name,
            to_number(row.get("UNIDAD")),
            to_number(row.get("MINIMOSTOC")),
            bool(row.get("INACTIVO")),
            raw_json(row),
        ])
    return output


def build_warehouses(rows):
    output = []
    for row in rows:
        code = to_int(row.get("CODIGO"))
        name = clean_text(row.get("NOMBRE"))
        if code is None or not name:
            continue
        output.append([
            code,
            name,
            clean_text(row.get("BREV_ALMA")),
            clean_text(row.get("RESPONSAB")),
            raw_json(row),
        ])
    return output


def build_stock(rows):
    output = []
    seen = set()
    for row in rows:
        product_code = clean_text(row.get("CODIGO"))
        warehouse_code = to_int(row.get("ALMACEN"))
        lot_code = clean_text(row.get("NROLOTE"))
        expiry_date = clean_text(row.get("FECHACADUC"))
        if not product_code:
            continue
        mirror_id = f"{product_code}|{warehouse_code or ''}|{lot_code or ''}|{expiry_date or ''}"
        if mirror_id in seen:
            suffix = len(seen)
            mirror_id = f"{mirror_id}|{suffix}"
        seen.add(mirror_id)
        output.append([
            mirror_id,
            product_code,
            warehouse_code,
            lot_code,
            expiry_date,
            to_number(row.get("SALDOACT")),
            to_number(row.get("INGRESOS")),
            to_number(row.get("SALIDAS")),
            to_number(row.get("RESERVADO")),
            raw_json(row),
        ])
    return output


def build_operation_headers(tables):
    configs = [
        ("ingreso", tables["entry_headers"], "FECHA", "PROVEDOR", "ALMACEN", None, None, "CONCEPTO"),
        ("salida", tables["dispatch_headers"], "FECHA", "CLIENTE", "ID_ALMA", None, None, "CONCEPTO"),
        ("traslado", tables["transfer_headers"], "FECHA", None, None, "ORIGEN", "DESTINO", "CONCEPTO"),
        ("ajuste", tables["adjustment_headers"], "FECHA", None, None, None, None, "CONCEPTO"),
    ]
    output = []
    for operation_type, rows, date_key, party_key, warehouse_key, origin_key, destination_key, concept_key in configs:
        for row in rows:
            document_number = to_int(row.get("NUMERO"))
            if document_number is None:
                continue
            output.append([
                f"{operation_type}:{document_number}",
                operation_type,
                document_number,
                clean_text(row.get(date_key)),
                to_int(row.get(party_key)) if party_key else None,
                to_int(row.get(warehouse_key)) if warehouse_key else None,
                to_int(row.get(origin_key)) if origin_key else None,
                to_int(row.get(destination_key)) if destination_key else None,
                clean_text(row.get(concept_key)),
                raw_json(row),
            ])
    return output


def build_operation_lines(tables):
    configs = [
        ("ingreso", tables["entry_lines"], None),
        ("salida", tables["dispatch_lines"], "ALMACEN"),
        ("traslado", tables["transfer_lines"], None),
        ("ajuste", tables["adjustment_lines"], "IDALMACEN"),
    ]
    output = []
    counters = {}
    for operation_type, rows, warehouse_key in configs:
        for row in rows:
            document_number = to_int(row.get("NUMERO"))
            if document_number is None:
                continue
            line_key = (operation_type, document_number)
            counters[line_key] = counters.get(line_key, 0) + 1
            line_number = counters[line_key]
            quantity = row.get("CANTIDAD")
            if operation_type == "ajuste":
                quantity = to_number(row.get("INGRESOS") or 0) - to_number(row.get("SALIDAS") or 0)
            output.append([
                f"{operation_type}:{document_number}:{line_number}",
                operation_type,
                document_number,
                line_number,
                clean_text(row.get("CODIGO")),
                to_number(quantity),
                clean_text(row.get("NROLOTE")),
                clean_text(row.get("FECHACADUC")),
                to_int(row.get(warehouse_key)) if warehouse_key else None,
                clean_text(row.get("NOMBREPROD")),
                raw_json(row),
            ])
    return output


def generate_sql(solucion_path):
    tables = load_tables(solucion_path)
    clients = build_clients(tables["clients"])
    products = build_products(tables["products"])
    warehouses = build_warehouses(tables["warehouses"])
    stock = build_stock(tables["stock"])
    operation_headers = build_operation_headers(tables)
    operation_lines = build_operation_lines(tables)

    sections = [
        "-- Importacion espejo de Solucion hacia Supabase.",
        "-- Ejecutar primero supabase/solucion_mirror.sql.",
        "-- Este archivo solo refresca tablas public.solucion_*.",
        "begin;",
        (
            "truncate table\n"
            "  public.solucion_operation_lines,\n"
            "  public.solucion_operation_headers,\n"
            "  public.solucion_stock,\n"
            "  public.solucion_clients,\n"
            "  public.solucion_products,\n"
            "  public.solucion_warehouses;"
        ),
        upsert_block(
            "public.solucion_clients",
            ["solucion_codigo", "name", "phone", "email", "contact", "status", "raw_data"],
            clients,
            ["solucion_codigo"],
            ["name", "phone", "email", "contact", "status", "raw_data", "synced_at"],
        ),
        upsert_block(
            "public.solucion_products",
            ["product_code", "barcode", "name", "unit_code", "min_stock", "inactive", "raw_data"],
            products,
            ["product_code"],
            ["barcode", "name", "unit_code", "min_stock", "inactive", "raw_data", "synced_at"],
        ),
        upsert_block(
            "public.solucion_warehouses",
            ["warehouse_code", "name", "short_name", "responsible", "raw_data"],
            warehouses,
            ["warehouse_code"],
            ["name", "short_name", "responsible", "raw_data", "synced_at"],
        ),
        upsert_block(
            "public.solucion_stock",
            [
                "mirror_id",
                "product_code",
                "warehouse_code",
                "lot_code",
                "expiry_date",
                "current_quantity",
                "incoming_quantity",
                "outgoing_quantity",
                "reserved_quantity",
                "raw_data",
            ],
            stock,
            ["mirror_id"],
            [
                "product_code",
                "warehouse_code",
                "lot_code",
                "expiry_date",
                "current_quantity",
                "incoming_quantity",
                "outgoing_quantity",
                "reserved_quantity",
                "raw_data",
                "synced_at",
            ],
        ),
        upsert_block(
            "public.solucion_operation_headers",
            [
                "mirror_id",
                "operation_type",
                "document_number",
                "document_date",
                "client_or_provider_code",
                "warehouse_code",
                "origin_warehouse_code",
                "destination_warehouse_code",
                "concept",
                "raw_data",
            ],
            operation_headers,
            ["mirror_id"],
            [
                "operation_type",
                "document_number",
                "document_date",
                "client_or_provider_code",
                "warehouse_code",
                "origin_warehouse_code",
                "destination_warehouse_code",
                "concept",
                "raw_data",
                "synced_at",
            ],
        ),
        upsert_block(
            "public.solucion_operation_lines",
            [
                "mirror_id",
                "operation_type",
                "document_number",
                "line_number",
                "product_code",
                "quantity",
                "lot_code",
                "expiry_date",
                "warehouse_code",
                "product_name",
                "raw_data",
            ],
            operation_lines,
            ["mirror_id"],
            [
                "operation_type",
                "document_number",
                "line_number",
                "product_code",
                "quantity",
                "lot_code",
                "expiry_date",
                "warehouse_code",
                "product_name",
                "raw_data",
                "synced_at",
            ],
        ),
        "commit;",
        (
            "select\n"
            "  (select count(*) from public.solucion_clients) as clientes,\n"
            "  (select count(*) from public.solucion_products) as productos,\n"
            "  (select count(*) from public.solucion_warehouses) as almacenes,\n"
            "  (select count(*) from public.solucion_stock) as stock,\n"
            "  (select count(*) from public.solucion_operation_headers) as operaciones,\n"
            "  (select count(*) from public.solucion_operation_lines) as lineas;"
        ),
    ]

    summary = {
        "clients": len(clients),
        "products": len(products),
        "warehouses": len(warehouses),
        "stock": len(stock),
        "operation_headers": len(operation_headers),
        "operation_lines": len(operation_lines),
    }
    return "\n\n".join(section for section in sections if section), summary


def main():
    parser = argparse.ArgumentParser(description="Genera SQL para cargar el espejo de Solucion en Supabase.")
    parser.add_argument("solucion_path", help="Ruta a la carpeta de Solucion/ComerSuite con archivos DBF.")
    parser.add_argument("--output", required=True, help="Archivo .sql de salida.")
    parser.add_argument("--summary", help="Archivo .json opcional con conteos.")
    args = parser.parse_args()

    solucion_path = Path(args.solucion_path)
    output_path = Path(args.output)
    summary_path = Path(args.summary) if args.summary else None

    sql, summary = generate_sql(solucion_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(sql, encoding="utf-8")

    if summary_path:
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print("SQL espejo generado")
    print(f"Salida: {output_path}")
    for key, count in summary.items():
        print(f"{key}: {count}")


if __name__ == "__main__":
    main()
