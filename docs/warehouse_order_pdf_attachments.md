# Ordenes de almacen adjuntas por correo

## Objetivo

Adjuntar al correo de cada operacion un PDF imprimible usando las plantillas oficiales:

- `templates/warehouse/orden_ingreso.docx`
- `templates/warehouse/orden_salida.docx`
- `templates/warehouse/orden_ingreso.pdf`
- `templates/warehouse/orden_salida.pdf`

Ingreso usa la plantilla de ingreso. Despacho o salida usa la plantilla de salida.

## Enfoque actual

Las plantillas PDF permiten generar el adjunto sin convertir Word. El generador usa el PDF como fondo y escribe los datos encima de los espacios correspondientes.

La Edge Function de Supabase ya puede enviar adjuntos por Resend. El siguiente paso productivo es conectar el generador de PDF al flujo de correo para que entregue el archivo en base64 antes del envio.

## Flujo recomendado

1. La app registra la operacion en Supabase.
2. La app o Supabase arma los datos de la operacion.
3. Un generador de documentos rellena el PDF correcto.
4. La Edge Function `send-movement-email` envia el correo con el PDF adjunto.

## Generador local incluido

El script `scripts/generate_warehouse_order_pdf.py` rellena las plantillas con datos JSON. Por defecto genera PDF directo desde las plantillas PDF.

Ejemplo:

```powershell
python scripts/generate_warehouse_order_pdf.py `
  --type salida `
  --format pdf `
  --payload tmp/warehouse_order_sample.json `
  --out tmp/orden_salida_prueba.pdf
```

Tambien puede generar DOCX desde las plantillas Word:

```powershell
python scripts/generate_warehouse_order_pdf.py `
  --type salida `
  --format docx `
  --payload tmp/warehouse_order_sample.json `
  --out tmp/orden_salida_prueba.docx
```

## Campos usados

- `Number`: numero de guia u operacion.
- `Fecha`: fecha de la operacion.
- `Empresa`: cliente.
- `Trans`: transportista o persona relacionada.
- `Contacto`: quien recibe o contacto.
- `Placa`: placa del vehiculo.
- `Observaciones`: observaciones de la operacion.
- `Recibido`: persona que recibe.
- `Entregado`: usuario o responsable.
- `Cantidad1..Cantidad8`: envases por linea.
- `Volumen1..Volumen8`: equivalente calculado.
- `Producto1..Producto8`: producto.
- `CantE1..CantE8`: cajas o embalaje.

## Siguiente paso para activarlo oficialmente

Conectar este generador al flujo de correo. Cuando el generador devuelva el PDF en base64, la Edge Function ya puede enviarlo como adjunto usando `attachments`.
