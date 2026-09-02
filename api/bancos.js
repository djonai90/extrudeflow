import { sql } from './_lib/db.js';
import { send, getBody, sameOrigin } from './_lib/http.js';
import { requireAdmin } from './_lib/auth.js';

const MAX_BYTES = 1_000_000;

export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT data->'bancos' AS bancos FROM user_data WHERE user_id = ${user.id}`;
    return send(res, 200, { bancos: rows[0] ? rows[0].bancos : null });
  }

  if (req.method === 'PUT') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const body = await getBody(req);
    const bancos = body ? body.bancos : undefined;
    if (bancos === undefined || bancos === null || typeof bancos !== 'object' || Array.isArray(bancos)) {
      return send(res, 400, { error: 'Payload inválido' });
    }
    const json = JSON.stringify(bancos);
    if (json.length > MAX_BYTES) return send(res, 413, { error: 'Los datos superan el tamaño permitido' });

    // scoped write: only touches data.bancos, never the rest of the user blob
    await sql`
      INSERT INTO user_data (user_id, data, updated_at)
      VALUES (${user.id}, jsonb_build_object('bancos', ${json}::jsonb), now())
      ON CONFLICT (user_id) DO UPDATE
        SET data = jsonb_set(COALESCE(user_data.data, '{}'::jsonb), '{bancos}', ${json}::jsonb),
            updated_at = now()
    `;
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
