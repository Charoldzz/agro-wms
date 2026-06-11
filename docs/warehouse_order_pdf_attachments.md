# Ordenes de almacen adjuntas por correo

## Objetivo

Adjuntar al correo de cada operacion un PDF imprimible usando las plantillas oficiales de Word:

- `templates/warehouse/orden_ingreso.docx`
- `templates/warehouse/orden_salida.docx`

Ingreso usa la plantilla de ingreso. Despacho o salida usa la plantilla de salida.

## Enfoque correcto

El documento oficial se genera desde Word con LibreOffice. Esto evita escribir texto encima de un PDF y permite que cada dato caiga dentro de su casilla real.

La Edge Function de Supabase no debe generar este PDF con LibreOffice porque Supabase Edge Functions no ejecuta LibreOffice. Su trabajo queda limitado a enviar el correo y adjuntar archivos que ya vengan generados.

## Flujo recomendado

1. La app registra la operacion en Supabase.
2. Un conector local o backend con LibreOffice genera el PDF desde la plantilla Word.
3. Ese conector envia el PDF en base64 a la Edge Function `send-movement-email`.
4. La Edge Function envia el correo con el PDF adjunto.

## Generador local incluido

El script `scripts/generate_warehouse_order_pdf.py` rellena las plantillas Word y convierte el resultado a PDF con LibreOffice.

Ejemplo para ingreso:

```powershell
python scripts/generate_warehouse_order_pdf.py `
  --type ingreso `
  --format pdf `
  --payload tmp/warehouse_order_sample.json `
  --out tmp/orden_ingreso_prueba.pdf
```

Ejemplo para salida:

```powershell
python scripts/generate_warehouse_order_pdf.py `
  --type salida `
  --format pdf `
  --payload tmp/warehouse_order_sample.json `
  --out tmp/orden_salida_prueba.pdf
```

## Servicio para que la app adjunte el PDF

La app web no genera el Word/PDF dentro del navegador. Cuando se guarda un ingreso o despacho, llama a un servicio HTTP que corre LibreOffice y devuelve el PDF listo para adjuntar.

Para probarlo localmente:

```powershell
python scripts/warehouse_document_service.py
```

El servicio queda escuchando en:

```text
http://127.0.0.1:8787/warehouse-order
```

En `.env` o en Vercel debe existir:

```text
VITE_WAREHOUSE_DOCUMENT_API_URL=http://127.0.0.1:8787
```

Importante: `127.0.0.1` solo sirve para pruebas en la misma computadora. Para produccion, este servicio debe estar instalado en una computadora/servidor siempre encendido y expuesto con una URL HTTPS segura. Sin esa URL configurada, la app enviara el correo normal, pero sin adjunto.

## Envio del adjunto

La Edge Function acepta adjuntos ya generados en el campo `attachments`:

```json
{
  "attachments": [
    {
      "filename": "orden-salida.pdf",
      "content": "BASE64_DEL_PDF"
    }
  ]
}
```

## Reglas visuales

- Las casillas sin dato quedan en blanco.
- Los placeholders restantes se eliminan.
- No se escriben textos redundantes dentro de las celdas.
- Las observaciones mantienen solo la indicacion: `Anotar observaciones con claridad`.
- Los valores largos se recortan para evitar que tapen etiquetas o invadan otras casillas.
