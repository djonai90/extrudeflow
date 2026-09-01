import { sql } from '../_lib/db.js';
import { send, sameOrigin } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = String(req.query.id || '');
  if (!id || id.length > 64) return send(res, 400, { error: 'ID inválido' });

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT mime, encode(bytes, 'base64') AS b64
      FROM images WHERE id = ${id} AND user_id = ${user.id}
    `;
    if (!rows[0]) return send(res, 404, { error: 'No encontrada' });
    const buf = Buffer.from(rows[0].b64, 'base64');
    res.statusCode = 200;
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.end(buf);
  }

  if (req.method === 'DELETE') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    await sql`DELETE FROM images WHERE id = ${id} AND user_id = ${user.id}`;
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
