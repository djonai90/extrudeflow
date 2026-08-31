import { sql } from './_lib/db.js';
import { send, getBody, sameOrigin } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';

const MAX_BYTES = 3_000_000;

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT data FROM user_data WHERE user_id = ${user.id}`;
    return send(res, 200, { data: rows[0] ? rows[0].data : null });
  }

  if (req.method === 'PUT') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const body = await getBody(req);
    const data = body ? body.data : undefined;
    if (data === undefined || data === null || typeof data !== 'object' || Array.isArray(data)) {
      return send(res, 400, { error: 'Payload inválido' });
    }
    const json = JSON.stringify(data);
    if (json.length > MAX_BYTES) return send(res, 413, { error: 'Los datos superan el tamaño permitido' });

    await sql`
      INSERT INTO user_data (user_id, data, updated_at)
      VALUES (${user.id}, ${json}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `;
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
