# Permisos recomendados

## Administrador

Puede:

- Crear y editar clientes.
- Crear lotes.
- Definir producto, presentación, ubicación y estado.
- Ver todos los lotes, movimientos y dashboard.
- Registrar entradas, salidas, traslados y ajustes.
- Descargar o abrir QR.

Uso típico:

- Responsable de almacén.
- Encargado administrativo.
- Persona que configura la base de datos.

## Operador

Puede:

- Iniciar sesión.
- Ver dashboard, clientes, productos y lotes.
- Escanear QR.
- Ver ficha del lote.
- Registrar entradas, salidas y traslados.
- Ver movimientos.

No debería poder:

- Crear clientes.
- Crear lotes nuevos.
- Cambiar datos maestros del producto.
- Cambiar reglas de presentación.
- Borrar inventario.

Uso típico:

- Personal de recepción.
- Personal de despacho.
- Personal que mueve producto dentro del almacén.

## Regla importante

Cada movimiento queda guardado con:

- Usuario.
- Fecha.
- Tipo de movimiento.
- Cantidad.
- Stock anterior.
- Stock nuevo.
- Observaciones.

Esto permite auditar quién hizo cada entrada, salida, traslado o ajuste.
