# agro-wms — Contexto del Proyecto

Documento de contexto compartido para cualquier IA (Claude, Codex, etc.).
**Actualizar este archivo cada vez que se haga un cambio importante.**

---

## Qué es este proyecto

Sistema web de gestión de almacén agrícola (WMS) para **Almacén G.A.T Bolivia**.
Maneja stock, ingresos, salidas, despachos, vencimientos y catálogo de productos por empresa cliente.

- **Producción:** https://todo-agricola.vercel.app
- **Repo GitHub:** https://github.com/Charoldzz/agro-wms.git
- **Deploy:** automático via Vercel en cada `git push` a `main`

---

## Stack técnico

- React 18 + Vite + Tailwind CSS
- Supabase (PostgreSQL) — backend y auth
- Lucide React — íconos
- React Router v6

---

## Estructura de archivos clave

```
src/
  App.jsx                          — rutas y roles
  hooks/useAuth.jsx                — auth de Supabase
  lib/supabase.js                  — cliente Supabase
  lib/version.js                   — versión actual (auto-generado)
  lib/pallets.js                   — helpers de cálculo de pallets
  components/
    AppVersion.jsx                 — badge de versión (esquina inferior derecha)
    AppLayout.jsx                  — layout con nav
    CatalogoModal.jsx              — modal de catálogo de productos
    EmpresasModal.jsx              — modal de empresas (CRUD)
    NewProductModal.jsx            — modal para nuevo producto del catálogo
    MovimientosModal.jsx           — historial de movimientos
  pages/
    Lots.jsx                       — /lotes (tabla de stock principal)
    OperatorEntry.jsx              — /operacion/nuevo-ingreso
    NuevaSalida.jsx                — /nueva-salida
    Kardex.jsx                     — /kardex
    ClientPortal.jsx               — / (vista cliente: solicitudes de despacho)
    ClientRequestsAdmin.jsx        — /solicitudes (admin)
    DispatchList.jsx               — /operacion/despacho-lista
    ProductCatalog.jsx             — /catalogo
    Dashboard.jsx                  — dashboard admin
public/
  app-version.json                 — { version, date, count } (auto-generado en build)
scripts/
  bump-version.js                  — genera versión en cada build
```

---

## Tablas Supabase

Todas las queries usan el filtro `inventory_source = 'stock_independiente'`.

| Tabla | Descripción |
|-------|-------------|
| `lots` | Stock por lote: id, lot_code, client_id, product, current_quantity, package_size, package_unit, location, expiry_date, status, inventory_source, entry_boxes, raw_data, pallet_units_per_pallet |
| `movements` | Ingresos y salidas, join a lots y profiles |
| `clients` | Empresas: id, name, inventory_source, product_code_prefix, contact |
| `product_catalog` | Catálogo de productos: id, client_id, code, name, package_size, package_unit |
| `profiles` | Usuarios con roles: administrador, operador, cliente |
| `client_dispatch_requests` | Solicitudes de despacho del portal cliente |

Los registros archivados usan `inventory_source = 'stock_independiente_archived'`.

---

## Roles de usuario

- `administrador` — acceso total
- `operador` — ingresos, salidas, despachos
- `cliente` — solo ve sus lotes y puede pedir despachos

---

## Sistema de versiones

- Formato: `v2026.06.21.1` (fecha Bolivia + contador diario)
- El contador sube con cada deploy de Vercel; se resetea a 1 cada día a medianoche hora Bolivia
- `scripts/bump-version.js` corre automáticamente en cada build (`npm run build`)
- El badge en la esquina inferior derecha muestra la versión y alerta cuando hay una nueva disponible

---

## Catálogo de productos y prefijos

- Cada empresa (`clients`) tiene un `product_code_prefix` (ej: GATB, TCML, ZEBI)
- Los códigos de producto se generan automáticamente: `GATB-00001`, `GATB-00002`, etc.
- TECNOMYL S.A y TECNOMYL (REPROCESO) comparten el prefijo `TCML` — la numeración es compartida entre ambas
- El catálogo web está sincronizado con el programa desktop (421 productos desktop / 420 web — diferencia intencional: IVLA pendiente de sync)
- Fuente de verdad para prefijos y productos: `inventario-independiente.json` del programa desktop

---

## Programa desktop (contexto)

C# WinForms — Panel Stock Independiente Portátil.
- Ruta en la máquina: `C:\Users\HAROLD\Desktop\PANEL STOCK INDEPENDIENTE PORTATIL-...\`
- Datos locales: `dist\Datos\inventario-independiente.json` (módulo ALQUILERES)
- No hay sync automático aún — se sincroniza manualmente con el script `scripts/generate_stock_independiente_import.py`

---

## Reglas importantes — NO revertir

- `inventory_source = 'stock_independiente'` en TODAS las queries a Supabase
- NO requerir aprobación admin para solicitudes de despacho (van directo a `pendiente`)
- NO mostrar pallets decimales por fila de lote (solo en totales)
- NO dejar registros viejos con `inventory_source='stock_independiente'` — archivar
- NO inventar prefijos de empresa — sacarlos de `inventario-independiente.json`
- La eliminación de empresas y productos tiene confirmación de seguridad obligatoria
- Siempre confirmar con Harold antes de hacer `git push`

---

## Flujo de solicitudes de despacho

```
Cliente crea → pendiente → en_preparacion → despachado
                                          ↘ rechazado
```

---

## Cambios recientes

| Versión | Cambio |
|---------|--------|
| v2026.06.21.2 | Botón Eliminar empresa con confirmación de seguridad |
| v2026.06.21.1 | Versión pasa a formato vAÑO.MES.DIA.N, auto-incrementa en cada deploy Vercel |
| v2026.06.20.x | Filtro de empresa en CatálogoModal cambiado a ícono botón con popover |
| v2026.06.20.x | Nombre de empresa editable en formulario Modificar, eliminado campo Observaciones |
| v2026.06.20.x | Corrección de prefijos de empresa en tabla clients (ZEBI, DEBA, SEMO, AGRO, etc.) |
| v2026.06.20.x | Corrección de códigos de producto en product_catalog (ZENT→ZEBI, DENB→DEBA, etc.) |
| v2026.06.20.x | Importación de 420 productos del desktop al catálogo web |
| v2026.06.20.x | Fix generador de código: TECNOMYL REPROCESO comparte secuencia TCML con TECNOMYL S.A |
