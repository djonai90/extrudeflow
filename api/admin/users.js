import { sql } from '../_lib/db.js';
import { send, getBody, sameOrigin } from '../_lib/http.js';
import { requireAdmin, hashPassword } from '../_lib/auth.js';

const USERNAME_RE = /^[A-Za-z0-9._@\- ]{3,40}$/;

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const users = await sql`
      SELECT u.id, u.username, u.role, u.active, u.created_at, u.last_login_at, u.locked_until,
             d.updated_at AS data_updated_at
      FROM users u
      LEFT JOIN user_data d ON d.user_id = u.id
      ORDER BY u.created_at
    `;
    return send(res, 200, { users });
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const body = await getBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'user';

    if (!USERNAME_RE.test(username)) {
      return send(res, 400, { error: 'Usuario inválido. Usa 3–40 caracteres: letras, números, punto, guion, guion bajo, @ o espacio.' });
    }
    if (password.length < 8) {
      return send(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const dup = await sql`SELECT 1 FROM users WHERE lower(username) = lower(${username})`;
    if (dup.length) return send(res, 409, { error: 'Ese usuario ya existe' });

    const rows = await sql`
      INSERT INTO users (username, password_hash, role, active)
      VALUES (${username}, ${hashPassword(password)}, ${role}, true)
      RETURNING id, username, role, active, created_at, last_login_at, locked_until
    `;
    return send(res, 201, { user: { ...rows[0], data_updated_at: null } });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
