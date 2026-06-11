from __future__ import annotations

import base64
import json
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    from .generate_warehouse_order_pdf import fill_template, convert_to_pdf
except ImportError:
    from generate_warehouse_order_pdf import fill_template, convert_to_pdf


ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates" / "warehouse"


def compact_token(value: str) -> str:
    token = "".join(ch if ch.isalnum() else "-" for ch in str(value or "orden").lower())
    token = "-".join(part for part in token.split("-") if part)
    return token[:60] or "orden"


def build_pdf(order_type: str, payload: dict) -> tuple[str, str]:
    template_name = "orden_ingreso.docx" if order_type == "ingreso" else "orden_salida.docx"
    template = TEMPLATES / template_name
    guide = payload.get("number") or payload.get("guide_number") or payload.get("operation_code") or order_type
    filename = f"orden-{order_type}-{compact_token(guide)}.pdf"

    with tempfile.TemporaryDirectory(prefix="todo-orden-") as temp_dir:
        temp_path = Path(temp_dir)
        docx_path = temp_path / filename.replace(".pdf", ".docx")
        pdf_path = temp_path / filename
        fill_template(template, payload, docx_path)
        generated_pdf = convert_to_pdf(docx_path, temp_path)
        if generated_pdf != pdf_path:
            generated_pdf.rename(pdf_path)
        content = base64.b64encode(pdf_path.read_bytes()).decode("ascii")
    return filename, content


class Handler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/warehouse-order":
            self.send_error(404, "Ruta no encontrada")
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            order_type = body.get("type")
            payload = body.get("payload") or {}
            if order_type not in {"ingreso", "salida"}:
                raise ValueError("type debe ser ingreso o salida")

            filename, content = build_pdf(order_type, payload)
            response = json.dumps({"filename": filename, "content": content}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        except Exception as error:
            response = json.dumps({"error": str(error)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8787), Handler)
    print("Generador de ordenes listo en http://127.0.0.1:8787/warehouse-order")
    server.serve_forever()


if __name__ == "__main__":
    main()
