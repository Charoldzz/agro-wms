import argparse
import csv
import json
import struct
from pathlib import Path


TABLES = {
    "clientes": {
        "file": "CLIENTE.DBF",
        "fields": ["CODIGO", "NOMBRE", "TELEFONOS", "EMAIL", "CONTACTO", "ESTADO"],
    },
    "productos": {
        "file": "CATALOGO.dbf",
        "fields": ["CODIGO", "CODBAR", "NOMBRE", "UNIDAD", "MINIMOSTOC", "INACTIVO"],
    },
    "stock": {
        "file": "STOCK.DBF",
        "fields": ["CODIGO", "ALMACEN", "NROLOTE", "FECHACADUC", "SALDOACT", "INGRESOS", "SALIDAS", "RESERVADO"],
    },
    "almacenes": {
        "file": "ALMACEN.DBF",
        "fields": ["CODIGO", "NOMBRE", "BREV_ALMA", "RESPONSAB"],
    },
    "ingresos_cabecera": {
        "file": "INGRECAB.dbf",
        "fields": ["NUMERO", "FECHA", "PROVEDOR", "ALMACEN", "CONCEPTO", "INGRESADO"],
    },
    "ingresos_detalle": {
        "file": "INGREDET.DBF",
        "fields": ["NUMERO", "CODIGO", "CANTIDAD", "FECHACADUC", "NROLOTE", "NROFABRI"],
    },
    "salidas_cabecera": {
        "file": "SALIDCAB.dbf",
        "fields": ["NUMERO", "FECHA", "CLIENTE", "ID_ALMA", "CONCEPTO", "NOMBRECLIE", "ESTADO"],
    },
    "salidas_detalle": {
        "file": "SALIDDET.dbf",
        "fields": ["NUMERO", "CODIGO", "CANTIDAD", "FECHACADUC", "NROLOTE", "ALMACEN", "NOMBREPROD"],
    },
    "traslados_cabecera": {
        "file": "TRASPCAB.dbf",
        "fields": ["NUMERO", "FECHA", "ORIGEN", "DESTINO", "CONCEPTO", "INGRESADO"],
    },
    "traslados_detalle": {
        "file": "TRASPDET.dbf",
        "fields": ["NUMERO", "CODIGO", "CANTIDAD", "FECHACADUC", "NROLOTE"],
    },
    "ajustes_cabecera": {
        "file": "AJUSTCAB.DBF",
        "fields": ["NUMERO", "FECHA", "CONCEPTO", "NUM_AJUSTE", "TOTAL_ING", "TOTAL_SAL"],
    },
    "ajustes_detalle": {
        "file": "AJUSTDET.DBF",
        "fields": ["NUMERO", "CODIGO", "INGRESOS", "SALIDAS", "FECHACADUC", "NROLOTE", "IDALMACEN"],
    },
}


def decode_text(raw):
    for encoding in ("cp1252", "latin1"):
        try:
            return raw.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return raw.decode("latin1", "replace").strip()


def read_dbf_schema(path):
    with path.open("rb") as file:
        header = file.read(32)
        if len(header) < 32:
            raise ValueError("DBF invalido o vacio")

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
        return ""
    if field_type == "N":
        try:
            return int(value) if "." not in value else float(value)
        except ValueError:
            return value
    if field_type == "D" and len(value) == 8:
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
    if field_type == "L":
        return value.upper() in {"T", "Y", "S"}
    return value


def read_sample(path, wanted_fields, limit=5):
    schema = read_dbf_schema(path)
    fields_by_name = {field["name"].upper(): field for field in schema["fields"]}
    selected = [fields_by_name[name.upper()] for name in wanted_fields if name.upper() in fields_by_name]
    rows = []

    with path.open("rb") as file:
        file.seek(schema["header_length"])
        for _ in range(schema["records"]):
            record = file.read(schema["record_length"])
            if not record or record[:1] == b"*":
                continue
            row = {}
            for field in selected:
                raw = record[field["offset"]:field["offset"] + field["length"]]
                row[field["name"]] = convert_value(raw, field["type"])
            rows.append(row)
            if len(rows) >= limit:
                break

    return schema, rows


def run_probe(solucion_path, output_dir=None):
    result = {
        "solucion_path": str(solucion_path),
        "mode": "readonly",
        "tables": {},
    }

    for key, config in TABLES.items():
        table_path = solucion_path / config["file"]
        if not table_path.exists():
            result["tables"][key] = {
                "file": config["file"],
                "exists": False,
                "records": 0,
                "sample": [],
            }
            continue

        schema, sample = read_sample(table_path, config["fields"])
        result["tables"][key] = {
            "file": config["file"],
            "exists": True,
            "records": schema["records"],
            "field_count": len(schema["fields"]),
            "fields": [field["name"] for field in schema["fields"]],
            "sample": sample,
        }

        if output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
            with (output_dir / f"{key}_sample.csv").open("w", newline="", encoding="utf-8-sig") as csv_file:
                writer = csv.DictWriter(csv_file, fieldnames=config["fields"])
                writer.writeheader()
                for row in sample:
                    writer.writerow({field: row.get(field, "") for field in config["fields"]})

    if output_dir:
        with (output_dir / "solucion_probe_summary.json").open("w", encoding="utf-8") as json_file:
            json.dump(result, json_file, ensure_ascii=False, indent=2)

    return result


def main():
    parser = argparse.ArgumentParser(description="Prueba solo lectura para bases DBF de Solucion.")
    parser.add_argument("solucion_path", help="Ruta a la carpeta ComerSuite/Solucion.")
    parser.add_argument("--output", help="Carpeta opcional para guardar muestras CSV y resumen JSON.")
    args = parser.parse_args()

    solucion_path = Path(args.solucion_path)
    output_dir = Path(args.output) if args.output else None
    result = run_probe(solucion_path, output_dir)

    print("Prueba solo lectura Solucion")
    print(f"Ruta: {result['solucion_path']}")
    print()
    for key, table in result["tables"].items():
        status = "OK" if table["exists"] else "NO ENCONTRADA"
        print(f"{key}: {status} | archivo: {table['file']} | registros: {table['records']}")
    if output_dir:
        print()
        print(f"Archivos de muestra guardados en: {output_dir}")


if __name__ == "__main__":
    main()
