import { sql } from './_lib/db.js';
import { send } from './_lib/http.js';

// Unauthenticated diagnostics for setup. Does not leak data.
export default async function handler(req, res) {
  const out = { db: false, tables: false, users: null, hasAdmin: null };
  try {
    await sql`SELECT 1`;
    out.db = true;
  } catch (e) {
    return send(res, 200, { ...out, error: 'No hay conexión a la base de datos. Revisa DATABASE_URL.' });
  }
  try {
    const rows = await sql`
      SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM users WHERE role = 'admin' AND active) AS admins
    `;
    out.tables = true;
    out.users = rows[0].users;
    out.hasAdmin = rows[0].admins > 0;
  } catch (e) {
    return send(res, 200, { ...out, error: 'Las tablas no existen todavía. Ejecuta: npm run init-db' });
  }
  return send(res, 200, out);
}
