# Ordenes de almacen adjuntas por correo

## Objetivo

Adjuntar al correo de cada operacion un PDF imprimible usando las plantillas oficiales:

- `templates/warehouse/orden_ingreso.docx`
- `templates/warehouse/orden_salida.docx`

Ingreso usa la plantilla de ingreso. Despacho o salida usa la plantilla de salida.

## Por que no se genera directamente solo con Supabase

La Edge Function de Supabase puede enviar adjuntos por Resend, pero no es el mejor lugar para convertir DOCX a PDF con fidelidad visual. Para que el PDF salga exactamente como Word, se necesita un conversor real como LibreOffice, Word o un servicio especializado de documentos.

## Flujo recomendado

1. La app registra la operacion en Supabase.
2. La app o Supabase arma los datos de la operacion.
3. Un generador de documentos rellena el DOCX correcto.
4. El generador convierte el DOCX a PDF.
5. La Edge Function `send-movement-email` envia el correo con el PDF adjunto.

## Generador local incluido

El script `scripts/generate_warehouse_order_pdf.py` rellena las plantillas con datos JSON.

Ejemplo:

```powershell
python scripts/generate_warehouse_order_pdf.py `
  --type salida `
  --payload tmp/warehouse_order_sample.json `
  --out tmp/orden_salida_prueba.docx
```

Para generar PDF, el servidor debe tener LibreOffice instalado:

```powershell
python scripts/generate_warehouse_order_pdf.py `
  --type salida `
  --payload tmp/warehouse_order_sample.json `
  --out tmp/orden_salida_prueba.docx `
  --pdf
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

Instalar el generador en un servidor o conector local con LibreOffice y conectarlo al flujo de correo. Cuando el generador devuelva el PDF en base64, la Edge Function ya puede enviarlo como adjunto usando `attachments`.
