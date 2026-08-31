import { sql } from '../../_lib/db.js';
import { send, getBody, sameOrigin } from '../../_lib/http.js';
import { requireAdmin, hashPassword } from '../../_lib/auth.js';

export default async function handler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const id = parseInt(req.query.id, 10);
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: 'ID inválido' });

  const target = (await sql`SELECT id, username, role, active FROM users WHERE id = ${id}`)[0];
  if (!target) return send(res, 404, { error: 'Usuario no encontrado' });

  if (req.method === 'PATCH') {
    const body = await getBody(req);

    if (typeof body.active === 'boolean') {
      if (target.id === admin.id && body.active === false) {
        return send(res, 400, { error: 'No puedes desactivar tu propia cuenta' });
      }
      await sql`UPDATE users SET active = ${body.active} WHERE id = ${id}`;
      if (!body.active) {
        await sql`DELETE FROM sessions WHERE user_id = ${id}`; // kick out immediately
      }
    }

    if (body.password !== undefined) {
      const password = String(body.password || '');
      if (password.length < 8) return send(res, 400, { error: 'La contraseña debe tener al menos 8 caracteres' });
      await sql`
        UPDATE users
        SET password_hash = ${hashPassword(password)}, failed_attempts = 0, locked_until = NULL
        WHERE id = ${id}
      `;
      await sql`DELETE FROM sessions WHERE user_id = ${id}`; // force re-login with the new password
    }

    if (body.role === 'admin' || body.role === 'user') {
      if (target.id === admin.id && body.role !== 'admin') {
        return send(res, 400, { error: 'No puedes quitarte a ti mismo el rol de administrador' });
      }
      await sql`UPDATE users SET role = ${body.role} WHERE id = ${id}`;
    }

    if (body.unlock === true) {
      await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ${id}`;
    }

    const updated = (await sql`
      SELECT u.id, u.username, u.role, u.active, u.created_at, u.last_login_at, u.locked_until,
             d.updated_at AS data_updated_at
      FROM users u LEFT JOIN user_data d ON d.user_id = u.id
      WHERE u.id = ${id}
    `)[0];
    return send(res, 200, { user: updated });
  }

  if (req.method === 'DELETE') {
    if (target.id === admin.id) return send(res, 400, { error: 'No puedes eliminar tu propia cuenta' });
    await sql`DELETE FROM users WHERE id = ${id}`; // cascades sessions + user_data
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
