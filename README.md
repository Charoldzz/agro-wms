# Agro WMS Bolivia

Mini-WMS web y móvil para almacenamiento agrícola de terceros. Cada lote tiene un QR único que abre su ficha desde el celular para registrar entradas, salidas, traslados internos y ajustes.

## Stack

- React + Vite
- Tailwind CSS
- Supabase Auth, Postgres, Realtime y RLS
- `html5-qrcode` para escaneo desde cámara
- `qrcode` para generar QR por lote

## Funcionalidades

- Login de usuarios con roles `administrador` y `operador`
- Gestión de clientes
- Gestión de lotes con cliente, producto, stock, ubicación, fecha, estado y foto opcional
- QR automático por lote
- Escaneo móvil de QR
- Movimientos con fecha, usuario y observaciones
- Validación de salida contra stock disponible
- Dashboard con total almacenado, ocupación, movimientos recientes, stock bajo y cantidad por cliente
- Historial completo por lote
- Búsqueda rápida, filtro por cliente y filtro por ubicación

## Instalación local

1. Instala dependencias:

```bash
npm install
```

2. Crea un proyecto en Supabase.

3. En Supabase SQL Editor ejecuta:

```sql
-- contenido de supabase/schema.sql
```

4. Opcionalmente carga datos iniciales:

```sql
-- contenido de supabase/seed.sql
```

5. Copia variables de entorno:

```bash
cp .env.example .env
```

6. Completa `.env`:

```bash
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_ANON_KEY
VITE_APP_BASE_URL=http://localhost:5173
```

7. Inicia:

```bash
npm run dev
```

## Crear usuarios

En Supabase ve a Authentication > Users y crea usuarios con correo y contraseña.

Para asignar rol, puedes editar la tabla `profiles`:

```sql
update public.profiles
set role = 'administrador', full_name = 'Administrador'
where id = 'UUID_DEL_USUARIO';
```

Roles:

- `administrador`: puede gestionar clientes, crear lotes y operar inventario.
- `operador`: puede consultar, escanear QR y registrar movimientos de inventario.

## Deploy

### Deploy en Vercel

1. Sube el proyecto a GitHub.
2. Importa el repositorio en Vercel.
3. Configura variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_BASE_URL=https://tu-dominio.vercel.app`
4. Build command: `npm run build`
5. Output directory: `dist`

### Deploy en Netlify

1. Importa el repositorio.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Agrega las mismas variables de entorno.

## Uso operativo

1. Registra clientes.
2. Crea lotes.
3. Descarga o imprime el QR del lote.
4. Pega el QR en el pallet, bolsa, silo o zona de almacenamiento.
5. Desde el celular, entra a la app, pulsa `Scan` y escanea el QR.
6. Registra entrada, salida, traslado o ajuste.

Si una salida supera el stock disponible, el sistema muestra:

```text
No hay inventario suficiente.
```

La misma regla también existe en la función SQL `register_movement`, para proteger la base de datos.

## Nota para producción

Para fotos reales conviene agregar un bucket de Supabase Storage llamado `lot-photos` y reemplazar el campo `photo_url` manual por carga de archivo. La estructura actual ya soporta mostrar la URL de una foto.
