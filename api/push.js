import { send, getBody, sameOrigin } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';
import {
  vapidPublicKey, pushConfigured, saveSubscription, removeSubscription, sendToUser,
} from './_lib/push.js';

// One function for the whole push surface (Hobby plan caps serverless functions):
//   GET                      -> { key }               public VAPID key
//   POST { subscription }     -> { ok }               store/refresh this browser's subscription
//   POST { test: true }       -> { sent, failed }     send a confirmation push to the caller
//   DELETE { endpoint }       -> { ok }               drop a subscription
export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    return send(res, 200, { key: pushConfigured() ? vapidPublicKey() : null });
  }

  if (req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const body = await getBody(req);

    if (body && body.test) {
      if (!pushConfigured()) return send(res, 503, { error: 'Notificaciones no configuradas' });
      const result = await sendToUser(user.id, {
        title: 'ExtrudeFlow',
        body: 'Listo — así se verán tus recordatorios de pago.',
        url: '/',
        tag: 'ef-test',
      });
      return send(res, 200, result);
    }

    try {
      await saveSubscription(user.id, body && body.subscription);
    } catch (e) {
      return send(res, e.httpStatus || 400, { error: e.message || 'Suscripción inválida' });
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const body = await getBody(req);
    await removeSubscription(user.id, body && body.endpoint);
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: 'Método no permitido' });
}
