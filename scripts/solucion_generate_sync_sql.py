import argparse
import json
import os
import subprocess
from pathlib import Path

from solucion_generate_mirror_sql import (
    build_clients,
    build_operation_headers,
    build_operation_lines,
    build_products,
    build_stock,
    build_warehouses,
    load_tables,
    upsert_block,
)
from split_sql_import import split_sql


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config" / "solucion_sync_config.example.json"


def load_config(path):
    config_path = Path(path) if path else DEFAULT_CONFIG
    with config_path.open("r", encoding="utf-8") as file:
        config = json.load(file)
    return config_path, config


def section_header(task):
    return [
        f"-- Sincronizacion {task} desde Solucion hacia Supabase.",
        "-- Ejecutar primero supabase/solucion_mirror.sql si las tablas espejo no existen.",
        "begin;",
    ]


def section_footer(task):
    if task == "stock":
        count_sql = "(select count(*) from public.solucion_stock) as stock"
    elif task == "masters":
        count_sql = (
            "(select count(*) from public.solucion_clients) as clientes,\n"
            "  (select count(*) from public.solucion_products) as productos,\n"
            "  (select count(*) from public.solucion_warehouses) as almacenes"
        )
    elif task == "operations":
        count_sql = (
            "(select count(*) from public.solucion_operation_headers) as operaciones,\n"
            "  (select count(*) from public.solucion_operation_lines) as lineas"
        )
    else:
        count_sql = (
            "(select count(*) from public.solucion_clients) as clientes,\n"
            "  (select count(*) from public.solucion_products) as productos,\n"
            "  (select count(*) from public.solucion_warehouses) as almacenes,\n"
            "  (select count(*) from public.solucion_stock) as stock,\n"
            "  (select count(*) from public.solucion_operation_headers) as operaciones,\n"
            "  (select count(*) from public.solucion_operation_lines) as lineas"
        )
    return ["commit;", f"select\n  {count_sql};"]


def generate_stock_sql(tables):
    stock = build_stock(tables["stock"])
    sections = section_header("stock")
    sections.append("truncate table public.solucion_stock;")
    sections.append(
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
        )
    )
    sections.extend(section_footer("stock"))
    return "\n\n".join(section for section in sections if section), {"stock": len(stock)}


def generate_masters_sql(tables):
    clients = build_clients(tables["clients"])
    products = build_products(tables["products"])
    warehouses = build_warehouses(tables["warehouses"])
    sections = section_header("masters")
    sections.append("truncate table public.solucion_clients, public.solucion_products, public.solucion_warehouses;")
    sections.append(
        upsert_block(
            "public.solucion_clients",
            ["solucion_codigo", "name", "phone", "email", "contact", "status", "raw_data"],
            clients,
            ["solucion_codigo"],
            ["name", "phone", "email", "contact", "status", "raw_data", "synced_at"],
        )
    )
    sections.append(
        upsert_block(
            "public.solucion_products",
            ["product_code", "barcode", "name", "unit_code", "min_stock", "inactive", "raw_data"],
            products,
            ["product_code"],
            ["barcode", "name", "unit_code", "min_stock", "inactive", "raw_data", "synced_at"],
        )
    )
    sections.append(
        upsert_block(
            "public.solucion_warehouses",
            ["warehouse_code", "name", "short_name", "responsible", "raw_data"],
            warehouses,
            ["warehouse_code"],
            ["name", "short_name", "responsible", "raw_data", "synced_at"],
        )
    )
    sections.extend(section_footer("masters"))
    return "\n\n".join(section for section in sections if section), {
        "clients": len(clients),
        "products": len(products),
        "warehouses": len(warehouses),
    }


def generate_operations_sql(tables):
    headers = build_operation_headers(tables)
    lines = build_operation_lines(tables)
    sections = section_header("operations")
    sections.append("truncate table public.solucion_operation_lines, public.solucion_operation_headers;")
    sections.append(
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
            headers,
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
        )
    )
    sections.append(
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
            lines,
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
        )
    )
    sections.extend(section_footer("operations"))
    return "\n\n".join(section for section in sections if section), {
        "operation_headers": len(headers),
        "operation_lines": len(lines),
    }


def generate_task_sql(solucion_path, task):
    tables = load_tables(solucion_path)
    if task == "stock":
        return generate_stock_sql(tables)
    if task == "masters":
        return generate_masters_sql(tables)
    if task == "operations":
        return generate_operations_sql(tables)
    if task == "full":
        stock_sql, stock_summary = generate_stock_sql(tables)
        masters_sql, masters_summary = generate_masters_sql(tables)
        operations_sql, operations_summary = generate_operations_sql(tables)
        sql = "\n\n".join([masters_sql, stock_sql, operations_sql])
        summary = {**masters_summary, **stock_summary, **operations_summary}
        return sql, summary
    raise ValueError(f"Tarea no soportada: {task}")


def write_outputs(sql, summary, output_dir, task, max_mb):
    output_path = output_dir / f"solucion_{task}_sync.sql"
    summary_path = output_dir / f"solucion_{task}_summary.json"
    parts_dir = output_dir / "parts" / task
    output_dir.mkdir(parents=True, exist_ok=True)
    parts_dir.mkdir(parents=True, exist_ok=True)

    for old_file in parts_dir.glob("*.sql"):
        old_file.unlink()

    output_path.write_text(sql, encoding="utf-8")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    chunks = split_sql(sql, int(max_mb * 1024 * 1024))
    for position, chunk in enumerate(chunks, start=1):
        part_path = parts_dir / f"solucion_{task}_part_{position:02d}.sql"
        part_path.write_text(chunk, encoding="utf-8")

    return output_path, summary_path, parts_dir, len(chunks)


def apply_sql(db_url, sql_path):
    subprocess.run(["psql", db_url, "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)], check=True)


def main():
    parser = argparse.ArgumentParser(description="Genera SQL de sincronizacion parcial desde Solucion.")
    parser.add_argument("--config", help="Ruta al archivo de configuracion JSON.")
    parser.add_argument("--task", choices=["stock", "masters", "operations", "full"], required=True)
    parser.add_argument("--solucion-path", help="Sobrescribe la ruta de Solucion del config.")
    parser.add_argument("--apply", action="store_true", help="Aplica el SQL con psql usando SUPABASE_DB_URL.")
    args = parser.parse_args()

    _, config = load_config(args.config)
    solucion_path = Path(args.solucion_path or config["solucion_path"])
    output_dir = ROOT / config.get("output_dir", "tmp/solucion_sync")
    max_mb = float(config.get("sql_part_max_mb", 1.5))

    if not solucion_path.exists():
        raise SystemExit(f"No existe la ruta de Solucion: {solucion_path}")

    sql, summary = generate_task_sql(solucion_path, args.task)
    output_path, summary_path, parts_dir, part_count = write_outputs(sql, summary, output_dir, args.task, max_mb)

    if args.apply:
        db_url = os.environ.get(config.get("database_url_env", "SUPABASE_DB_URL"))
        if not db_url:
            raise SystemExit("Falta la variable SUPABASE_DB_URL para aplicar directo a Supabase.")
        apply_sql(db_url, output_path)
        if args.task in {"stock", "masters", "full"}:
            apply_sql(db_url, ROOT / "supabase" / "apply_solucion_inventory_to_app.sql")
            apply_sql(db_url, ROOT / "supabase" / "sync_client_profiles_to_solucion_clients.sql")

    print(f"Tarea: {args.task}")
    print(f"SQL: {output_path}")
    print(f"Resumen: {summary_path}")
    print(f"Partes SQL: {parts_dir} ({part_count})")
    for key, value in summary.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
