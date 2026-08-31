import { sql } from '../_lib/db.js';
import { send, getBody, sameOrigin } from '../_lib/http.js';
import { verifyPassword, createSession } from '../_lib/auth.js';

const MAX_FAILS = 10;
const LOCK_MINUTES = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const body = await getBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return send(res, 400, { error: 'Escribe usuario y contraseña' });

  const rows = await sql`
    SELECT id, username, password_hash, role, active, failed_attempts, locked_until
    FROM users WHERE lower(username) = lower(${username})
  `;
  const user = rows[0];

  if (user && user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return send(res, 423, { error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta en unos minutos.' });
  }

  const ok = user && verifyPassword(password, user.password_hash);

  if (!user || !ok) {
    if (user) {
      const fails = (user.failed_attempts || 0) + 1;
      const lock = fails >= MAX_FAILS
        ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
        : null;
      await sql`UPDATE users SET failed_attempts = ${fails}, locked_until = ${lock} WHERE id = ${user.id}`;
    }
    await new Promise((r) => setTimeout(r, 400)); // slow down brute force
    return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
  }

  if (!user.active) {
    return send(res, 403, { error: 'Tu acceso está desactivado. Contacta al administrador.' });
  }

  await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = ${user.id}`;
  await createSession(res, user.id);
  return send(res, 200, { username: user.username, role: user.role });
}
