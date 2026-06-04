# Sincronizacion profesional con Solucion

Objetivo: que Solucion sea la fuente oficial de clientes, productos, lotes y stock, y que Todo Agricola WMS muestre esa informacion lo mas actualizada posible.

## Frecuencias recomendadas

- Stock y despachos pendientes: cada 1 minuto.
- Clientes, productos y lotes nuevos: cada 15 minutos.
- Movimientos realizados desde la app: inmediato, cuando se active escritura hacia Solucion.
- Conciliacion completa: una vez por noche, idealmente 02:00.

## Como debe funcionar

1. El conector se instala en la computadora o servidor donde estan los archivos de Solucion.
2. El conector lee archivos DBF de Solucion.
3. El conector actualiza las tablas espejo `public.solucion_*` en Supabase.
4. Luego ejecuta `supabase/apply_solucion_inventory_to_app.sql` para reflejar el stock actual en la app.
5. La app consulta solo los lotes con `inventory_source = 'solucion'`.

## Tareas separadas

### Stock cada 1 minuto

Actualiza solo:

- `public.solucion_stock`
- lotes visibles en la app
- cantidades actuales
- vencimientos y ubicaciones del stock

Comando base:

```powershell
python scripts/solucion_generate_sync_sql.py --config config/solucion_sync_config.json --task stock
```

### Clientes y productos cada 15 minutos

Actualiza:

- `public.solucion_clients`
- `public.solucion_products`
- `public.solucion_warehouses`

Comando base:

```powershell
python scripts/solucion_generate_sync_sql.py --config config/solucion_sync_config.json --task masters
```

### Conciliacion completa nocturna

Actualiza todo:

- clientes
- productos
- almacenes
- stock
- operaciones historicas visibles

Comando base:

```powershell
python scripts/solucion_generate_sync_sql.py --config config/solucion_sync_config.json --task full
```

## Para aplicar directo a Supabase

Cuando ya este listo el servidor oficial, se puede activar aplicacion directa con `psql`.

1. Crear una variable de entorno:

```powershell
$env:SUPABASE_DB_URL="postgresql://..."
```

2. Ejecutar con `--apply`:

```powershell
python scripts/solucion_generate_sync_sql.py --config config/solucion_sync_config.json --task stock --apply
```

## Recomendacion de implementacion oficial

Usar el Programador de tareas de Windows en la computadora/servidor de Solucion:

- Tarea 1: stock cada 1 minuto.
- Tarea 2: clientes/productos cada 15 minutos.
- Tarea 3: sincronizacion completa cada noche a las 02:00.

Esto es mejor que depender de una pantalla abierta en la app, porque sigue trabajando aunque nadie este usando el sistema web.
