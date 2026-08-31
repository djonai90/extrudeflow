import { send } from '../_lib/http.js';
import { destroySession, clearSession } from '../_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  await destroySession(req);
  clearSession(res);
  return send(res, 200, { ok: true });
}
