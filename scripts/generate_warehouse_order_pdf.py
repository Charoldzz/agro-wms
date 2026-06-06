from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from docx import Document


MAX_TEMPLATE_ROWS = 8
PLACEHOLDER_RE = re.compile(r"\{\{[^}]+\}\}")


def fmt(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def compact(value, max_length: int = 48) -> str:
    text = fmt(value).replace("\n", " ").strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 3].rstrip() + "..."


def replace_in_paragraph(paragraph, values: dict[str, str]) -> None:
    original = paragraph.text
    text = original
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", fmt(value))
    text = PLACEHOLDER_RE.sub("", text)
    text = text.replace("Anotar Observaciones con Claridad", "Anotar observaciones con claridad")
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
        "Empresa": compact(payload.get("client", ""), 34),
        "Trans": compact(payload.get("driver_name") or payload.get("receiver_name") or "", 28),
        "Contacto": compact(payload.get("contact") or payload.get("receiver_name") or "", 34),
        "Placa": compact(payload.get("vehicle_plate", ""), 18),
        "Observaciones": "",
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
        values[f"CantE{index}"] = item.get("box_count") or item.get("packaging") or ""

    return values


def set_cell_text(cell, text: str) -> None:
    cell.text = fmt(text)
    for paragraph in cell.paragraphs:
        for run in paragraph.runs:
            run.font.size = None


def fill_items_table(doc: Document, payload: dict) -> None:
    if not doc.tables:
        return

    items = payload.get("items") or []
    table = doc.tables[0]

    for index in range(MAX_TEMPLATE_ROWS):
        row_index = index + 2
        if row_index >= len(table.rows):
            break
        row = table.rows[row_index]
        item = items[index] if index < len(items) else {}
        quantity = item.get("quantity", "")
        package_size = float(item.get("package_size") or 0)
        package_unit = item.get("package_unit") or ""
        equivalent = ""
        if quantity != "" and package_size:
            equivalent = f"{float(quantity) * package_size:g} {package_unit}".strip()

        product = item.get("product", "")
        lot_code = item.get("lot_code", "")
        if product and lot_code:
            product = f"{compact(product, 46)} | Lote {compact(lot_code, 20)}"

        cells = row.cells
        set_cell_text(cells[0], f"{fmt(quantity)} env." if quantity != "" else "")
        set_cell_text(cells[1], equivalent)
        set_cell_text(cells[2], product)
        set_cell_text(cells[3], item.get("box_count") or "")
        for cell in cells[4:]:
            set_cell_text(cell, "")


def fill_template(template_path: Path, payload: dict, output_docx: Path) -> None:
    doc = Document(template_path)
    values = build_values(payload)

    for paragraph in doc.paragraphs:
        replace_in_paragraph(paragraph, values)
    for table in doc.tables:
        replace_in_table(table, values)
    fill_items_table(doc, payload)

    output_docx.parent.mkdir(parents=True, exist_ok=True)
    doc.save(output_docx)


def convert_to_pdf(docx_path: Path, output_dir: Path) -> Path:
    fallback_soffice = Path("C:/Program Files/LibreOffice/program/soffice.exe")
    soffice = shutil.which("soffice") or shutil.which("libreoffice") or (str(fallback_soffice) if fallback_soffice.exists() else None)
    if not soffice:
        raise RuntimeError(
            "No se encontro LibreOffice/soffice. Instala LibreOffice en el servidor "
            "o usa este script solo para generar DOCX."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="todo-lo-profile-") as profile_dir:
        subprocess.run(
            [
                soffice,
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                f"-env:UserInstallation={Path(profile_dir).resolve().as_uri()}",
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
            timeout=60,
        )
    return output_dir / f"{docx_path.stem}.pdf"


def main() -> None:
    parser = argparse.ArgumentParser(description="Rellena una orden de almacen en Word y opcionalmente la convierte a PDF.")
    parser.add_argument("--type", choices=["ingreso", "salida"], required=True)
    parser.add_argument("--payload", required=True, help="Archivo JSON con los datos de la operacion.")
    parser.add_argument("--out", required=True, help="Ruta de salida DOCX o PDF.")
    parser.add_argument("--format", choices=["pdf", "docx"], default="pdf")
    parser.add_argument("--pdf", action="store_true", help="Alias de --format pdf.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    payload = json.loads(Path(args.payload).read_text(encoding="utf-8-sig"))
    output_path = Path(args.out)

    template = root / "templates" / "warehouse" / (
        "orden_ingreso.docx" if args.type == "ingreso" else "orden_salida.docx"
    )
    wants_pdf = args.pdf or args.format == "pdf" or output_path.suffix.lower() == ".pdf"
    docx_output = output_path.with_suffix(".docx") if wants_pdf else output_path
    fill_template(template, payload, docx_output)

    if wants_pdf:
        pdf_path = convert_to_pdf(docx_output, output_path.parent)
        if pdf_path != output_path:
            output_path.unlink(missing_ok=True)
            pdf_path.rename(output_path)
        print(output_path)
    else:
        print(docx_output)


if __name__ == "__main__":
    main()

