import { sql } from '../_lib/db.js';
import { send, getBody, sameOrigin } from '../_lib/http.js';
import { requireUser, verifyPassword, hashPassword } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const user = await requireUser(req, res);
  if (!user) return;

  const body = await getBody(req);
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (next.length < 8) return send(res, 400, { error: 'La nueva contraseña debe tener al menos 8 caracteres' });

  const rows = await sql`SELECT password_hash FROM users WHERE id = ${user.id}`;
  if (!rows[0] || !verifyPassword(current, rows[0].password_hash)) {
    return send(res, 400, { error: 'Contraseña actual incorrecta' });
  }

  await sql`UPDATE users SET password_hash = ${hashPassword(next)} WHERE id = ${user.id}`;
  return send(res, 200, { ok: true });
}
