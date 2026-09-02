import { send, sameOrigin } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';
import { sendToUser, pushConfigured } from '../_lib/push.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
  if (!pushConfigured()) return send(res, 503, { error: 'Notificaciones no configuradas' });

  const result = await sendToUser(user.id, {
    title: 'ExtrudeFlow',
    body: 'Listo — así se verán tus recordatorios de pago.',
    url: '/',
    tag: 'ef-test',
  });
  return send(res, 200, result);
}
