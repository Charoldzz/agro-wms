from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

from docx import Document


MAX_TEMPLATE_ROWS = 8


def fmt(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def replace_in_paragraph(paragraph, values: dict[str, str]) -> None:
    original = paragraph.text
    text = original
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", fmt(value))
    if text == original:
        return

    # Word often splits placeholders across runs. Rebuild the paragraph text
    # when a replacement is needed so every marker is filled consistently.
    for run in paragraph.runs:
        run.text = ""
    if paragraph.runs:
        paragraph.runs[0].text = text
    else:
        paragraph.add_run(text)


def replace_in_table(table, values: dict[str, str]) -> None:
    for row in table.rows:
        for cell in row.cells:
            for paragraph in cell.paragraphs:
                replace_in_paragraph(paragraph, values)


def build_values(payload: dict) -> dict[str, str]:
    items = payload.get("items") or []
    values = {
        "Number": payload.get("number", ""),
        "Fecha": payload.get("date", ""),
        "Empresa": payload.get("client", ""),
        "Trans": payload.get("driver_name") or payload.get("receiver_name") or "",
        "Contacto": payload.get("contact") or payload.get("receiver_name") or "",
        "Placa": payload.get("vehicle_plate", ""),
        "Observaciones": payload.get("notes", ""),
        "Recibido": payload.get("received_by", ""),
        "Entregado": payload.get("delivered_by") or payload.get("user_email", ""),
    }

    for index in range(1, MAX_TEMPLATE_ROWS + 1):
        item = items[index - 1] if index <= len(items) else {}
        quantity = item.get("quantity", "")
        package_size = float(item.get("package_size") or 0)
        package_unit = item.get("package_unit") or ""
        equivalent = ""
        if quantity != "" and package_size:
            equivalent = f"{float(quantity) * package_size:g} {package_unit}".strip()
        values[f"Cantidad{index}"] = quantity
        values[f"Volumen{index}"] = equivalent
        values[f"Producto{index}"] = item.get("product", "")
        values[f"CantE{index}"] = (
            item.get("box_count")
            or item.get("packaging")
            or item.get("quantity")
            or ""
        )

    return values


def fill_template(template_path: Path, payload: dict, output_docx: Path) -> None:
    doc = Document(template_path)
    values = build_values(payload)

    for paragraph in doc.paragraphs:
        replace_in_paragraph(paragraph, values)
    for table in doc.tables:
        replace_in_table(table, values)

    output_docx.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output_docx)


def convert_to_pdf(docx_path: Path, output_dir: Path) -> Path:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError(
            "No se encontro LibreOffice/soffice. Instala LibreOffice en el servidor "
            "o usa este script solo para generar DOCX."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            soffice,
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_dir),
            str(docx_path),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    return output_dir / f"{docx_path.stem}.pdf"


def main() -> None:
    parser = argparse.ArgumentParser(description="Rellena una orden de almacen y opcionalmente la convierte a PDF.")
    parser.add_argument("--type", choices=["ingreso", "salida"], required=True)
    parser.add_argument("--payload", required=True, help="Archivo JSON con los datos de la operacion.")
    parser.add_argument("--out", required=True, help="Ruta DOCX de salida.")
    parser.add_argument("--pdf", action="store_true", help="Convierte el DOCX a PDF usando LibreOffice/soffice.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    template = root / "templates" / "warehouse" / (
        "orden_ingreso.docx" if args.type == "ingreso" else "orden_salida.docx"
    )
    payload = json.loads(Path(args.payload).read_text(encoding="utf-8-sig"))
    output_docx = Path(args.out)
    fill_template(template, payload, output_docx)

    if args.pdf:
        pdf_path = convert_to_pdf(output_docx, output_docx.parent)
        print(pdf_path)
    else:
        print(output_docx)


if __name__ == "__main__":
    main()
