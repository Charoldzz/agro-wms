# Sincronización Panel Stock (escritorio) ↔ Web App

Estado: **preparación de caminos** (2026-07-09). La sincronización automática bidireccional
llega en Fase 2, cuando se pueda tocar el código fuente del programa (máquina de Ivan).

## Arquitectura de datos

| Lado | Dónde viven los datos |
|---|---|
| Programa (C# WinForms) | `dist\Datos\inventario-independiente.json` (claves `Products`, `Movements`, `LastMovementId`, `LastNoteNumber`) + `config\productos-medidas.csv` + `config\empresas-precios.csv` |
| Web app | Supabase: `lots`, `movements`, `warehouse_operations`, `clients`, `product_catalog`, `client_dispatch_requests`, `desktop_movements` |

### Claves de correspondencia
- **Producto:** código del programa (ej. `GATB-00006`) ↔ `lots.solucion_product_code` / prefijo → `clients.product_code_prefix`.
  Fallback: nombre del producto en mayúsculas.
- **Nota/guía:** `Movements.NoteNumber` (ING-XXXXX / SAL-XXXXX) ↔ `warehouse_operations.guide_number`.
  ⚠️ El programa y la web llevan contadores de guía separados. Antes de la Fase 2 hay que
  unificar el contador o usar prefijos distintos (ej. la web emite `WSAL-`/`WING-`) para evitar colisiones.
- **Movimiento del programa importado:** `desktop_movements.id` = `Movements[].Id` del JSON (idempotente por `ON CONFLICT (id) DO NOTHING`).

## Camino 1: programa → web (YA FUNCIONA, manual)

1. Copiar del programa el archivo `dist\Datos\inventario-independiente.json` actualizado.
2. Historial de movimientos:
   ```
   python scripts/generate_desktop_movements_import.py "RUTA\inventario-independiente.json"
   ```
   → genera `tmp/desktop_movements_import/part_NN.sql` → correr en orden en el SQL Editor de Supabase.
   (part_01 hace TRUNCATE: recarga completa, siempre idempotente.)
3. Inventario (lotes/saldos):
   ```
   python scripts/generate_stock_independiente_import.py "RUTA a dist o ZIP"
   ```
   → genera SQL en `tmp\stock_independiente_import_desktop\` → correr en Supabase.
   Archiva los registros viejos como `stock_independiente_archived`.

## Camino 2: web → programa (YA FUNCIONA el export, falta el import del lado programa)

- En la web: **Exportes → "Sincronización con el programa" → Exportar para el programa**.
- Genera `operaciones-web-para-programa-FECHA.json`:
  ```json
  {
    "GeneratedAt": "...",
    "Source": "todo-agricola-web",
    "FormatVersion": 1,
    "Movements": [
      {
        "NoteNumber": "SAL-01448", "Type": "SALIDA", "Date": "...",
        "ProductCode": "GATB-00009", "ProductName": "...", "Lot": "...",
        "Quantity": 50, "PackageSize": 5, "PackageUnit": "lt",
        "DispatchCompany": "...", "Observations": "...", "WebMovementId": "uuid"
      }
    ]
  }
  ```
- `WebMovementId` es la clave de idempotencia para que el programa no importe dos veces la misma operación.
- **Pendiente Fase 2:** botón "Importar operaciones web" en el programa (necesita el código fuente),
  que aplique cada movimiento como INGRESO/SALIDA y guarde los `WebMovementId` ya procesados.

## Backups

- Pantalla **Backups** de la web: botón "Descargar backup" exporta TODAS las tablas a un JSON
  (guardar en Drive/OneDrive; hacerlo semanal y antes de cada importación grande).
- El JSON del programa (`inventario-independiente.json`) es a la vez su base de datos y su backup:
  copiarlo junto con el backup de la web para tener el par consistente.
- Supabase Pro (backup diario automático) recomendado antes del uso oficial.

## Fase 2 (cuando haya acceso al código fuente del programa)

1. Unificar contadores de guía (o prefijos distintos web/programa).
2. Botón "Sincronizar" en el programa: lee Supabase (push/pull) directamente vía API REST de Supabase
   con una service key, sin archivos intermedios.
3. La web deja de importar por SQL manual: el programa publica su JSON a un bucket de Storage
   y una Edge Function lo aplica.
4. Definir resolución de conflictos: si el mismo lote se movió en ambos lados el mismo día,
   gana el orden cronológico y se recalcula el saldo.
