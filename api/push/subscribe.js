import { send, getBody, sameOrigin } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { saveSubscription, removeSubscription } from '../_lib/push.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const body = await getBody(req);

  if (req.method === 'POST') {
    try {
      await saveSubscription(user.id, body && body.subscription);
    } catch (e) {
      return send(res, e.httpStatus || 400, { error: e.message || 'Suscripción inválida' });
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    await removeSubscription(user.id, body && body.endpoint);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
