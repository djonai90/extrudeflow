import { send } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { vapidPublicKey, pushConfigured } from '../_lib/push.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'GET') return send(res, 405, { error: 'Método no permitido' });
  return send(res, 200, { key: pushConfigured() ? vapidPublicKey() : null });
}
