import { send } from '../_lib/http.js';
import { getUser } from '../_lib/auth.js';

export default async function handler(req, res) {
  const user = await getUser(req, res);
  if (!user) return send(res, 401, { error: 'No autenticado' });
  return send(res, 200, { username: user.username, role: user.role });
}
