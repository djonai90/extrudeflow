# ExtrudeFlow

Gestor y calculadora de cotización de impresión 3D.

- **Frontend:** `index.html` (app) + `admin.html` (panel de administración). Sin build.
- **Backend:** funciones serverless en `/api` (Node, ES modules) sobre Vercel.
- **Base de datos:** Postgres (Neon).

## Arquitectura

| Tabla        | Para qué |
|--------------|----------|
| `users`      | usuario, hash de contraseña (scrypt), rol (`user`/`admin`), activo, bloqueo por intentos fallidos |
| `sessions`   | sesión por cookie `ef_session` (HttpOnly, Secure, SameSite=Lax). Se guarda el **hash** del token. 30 días, deslizante |
| `user_data`  | un registro por usuario con todo el objeto `data` de la app (settings, printers, filaments, figures, impresiones) como `jsonb` |
| `images`     | fotos de piezas: `bytea` redimensionado en el cliente (~200 KB), referenciado por id desde figures/impresiones. `ON DELETE CASCADE` por usuario |

Cada usuario solo lee/escribe su propio `user_data` y sus `images`. El rol `admin` puede gestionar usuarios vía `/api/admin/*` y `admin.html`.

> Si actualizas desde una versión anterior, corre `node --env-file=.env scripts/init-db.mjs` de nuevo (idempotente) para crear la tabla `images`.

### Endpoints

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| POST | `/api/auth/login` | público | inicia sesión, setea cookie |
| POST | `/api/auth/logout` | sesión | cierra sesión |
| GET  | `/api/auth/me` | público | devuelve `{username, role}` o 401 |
| POST | `/api/auth/change-password` | sesión | cambia la propia contraseña |
| GET  | `/api/data` | sesión | datos del usuario |
| PUT  | `/api/data` | sesión | reemplaza los datos del usuario |
| GET  | `/api/admin/users` | admin | lista de usuarios |
| POST | `/api/admin/users` | admin | crea usuario |
| PATCH | `/api/admin/users/:id` | admin | activar/desactivar, resetear contraseña, cambiar rol, desbloquear |
| DELETE | `/api/admin/users/:id` | admin | elimina usuario y sus datos |
| GET | `/api/health` | público | diagnóstico de conexión y esquema (sin datos sensibles) |

## Puesta en marcha (una sola vez)

### 1. Crear la base de datos en Vercel

1. [vercel.com](https://vercel.com) → team **The Health Synergy** → proyecto **extrudeflow** → pestaña **Storage**.
2. **Create Database** → **Neon** (Serverless Postgres) → plan **Free** → región cercana (p. ej. `aws-us-east-1`).
3. **Connect** al proyecto `extrudeflow`, en los 3 entornos (Production, Preview, Development).
   Esto crea automáticamente la variable de entorno **`DATABASE_URL`** (y algunas `POSTGRES_*`). El código solo usa `DATABASE_URL`.

### 2. Desplegar el código

```bash
git add -A
git commit -m "Auth + backend con Postgres"
git push
```

Vercel construye y despliega solo. Tras el deploy, las funciones ya existen pero la base aún no tiene tablas.

### 3. Crear tablas y tu usuario admin (desde tu compu)

Necesitas el valor de `DATABASE_URL`. Opción A (recomendada), con Vercel CLI:

```bash
npm i -g vercel
vercel link            # elige team The Health Synergy / proyecto extrudeflow
vercel env pull .env   # descarga DATABASE_URL a .env (ya está en .gitignore)
```

Luego:

```bash
npm install
node --env-file=.env scripts/init-db.mjs      # crea las tablas
node --env-file=.env scripts/create-admin.mjs  # te pide usuario y contraseña (los eliges tú)
```

> Opción B sin CLI: copia `DATABASE_URL` desde Vercel → Settings → Environment Variables y ejecuta
> `DATABASE_URL="postgres://..." node scripts/init-db.mjs` (igual para `create-admin`).

### 4. Verificar

- Abre `https://extrudeflow.com.mx/api/health` → debe responder `{"db":true,"tables":true,"hasAdmin":true,...}`.
- Abre `https://extrudeflow.com.mx/` → pantalla de login. Entra con tu usuario admin.
  - En **Ajustes** verás **Panel de administrador** (solo para admins) → `admin.html`.
- La primera vez, si el navegador tenía datos locales, la app ofrece importarlos a tu cuenta.

## Uso del panel admin (`/admin`)

- **Crear usuario:** defines usuario + contraseña temporal + rol. Le pasas esa contraseña; el usuario puede cambiarla en Ajustes → *Cambiar mi contraseña*.
- **Resetear contraseña:** define una nueva. Se cierran las sesiones de ese usuario.
- **Desactivar / activar:** al desactivar, sus sesiones se cierran de inmediato y no puede entrar.
- **Hacer / quitar admin.**
- **Eliminar:** borra el usuario y todos sus datos (irreversible).
- No puedes desactivarte, quitarte admin ni eliminarte a ti mismo.

## Notas de seguridad

- Contraseñas: `scrypt` (N=16384) con sal por usuario; comparación `timingSafeEqual`. Nunca viajan ni se guardan en claro.
- Sesiones: token de 32 bytes; en la BD se guarda su SHA-256. Cookie `HttpOnly; Secure; SameSite=Lax`.
- Bloqueo: 10 intentos fallidos → 15 min de bloqueo. Reseteo de contraseña o "Desbloquear" lo limpia.
- CSRF: se rechazan peticiones mutantes con `Origin` de otro host.
- Mantener secreto el archivo `.env` (está en `.gitignore`).

## Desarrollo local

```bash
vercel dev     # sirve el sitio + las funciones en http://localhost:3000 usando .env
```
