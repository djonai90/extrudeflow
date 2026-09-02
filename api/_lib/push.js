import webpush from 'web-push';
import { sql } from './db.js';

const PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || 'https://www.extrudeflow.com.mx';

let ready = false;
export function pushConfigured() {
  return Boolean(PUBLIC && PRIVATE);
}
function ensure() {
  if (ready) return;
  if (!pushConfigured()) throw new Error('VAPID keys no configuradas');
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  ready = true;
}

export function vapidPublicKey() {
  return PUBLIC;
}

export async function saveSubscription(userId, sub) {
  const endpoint = sub && sub.endpoint;
  const p256dh = sub && sub.keys && sub.keys.p256dh;
  const auth = sub && sub.keys && sub.keys.auth;
  if (!endpoint || !p256dh || !auth) throw Object.assign(new Error('Suscripción inválida'), { httpStatus: 400 });
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${userId}, ${endpoint}, ${p256dh}, ${auth})
    ON CONFLICT (endpoint) DO UPDATE
      SET user_id = ${userId}, p256dh = ${p256dh}, auth = ${auth}
  `;
}

export async function removeSubscription(userId, endpoint) {
  if (!endpoint) return;
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint} AND user_id = ${userId}`;
}

// Sends `payload` (object) to every subscription of `userId`.
// Prunes subscriptions the push service reports as gone (404/410).
// Returns { sent, failed, removed }.
export async function sendToUser(userId, payload) {
  ensure();
  const rows = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}`;
  const body = JSON.stringify(payload);
  let sent = 0, failed = 0, removed = 0;
  for (const r of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
        body,
        { TTL: 60 * 60 * 24 }
      );
      sent++;
      await sql`UPDATE push_subscriptions SET last_ok_at = now() WHERE id = ${r.id}`;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        await sql`DELETE FROM push_subscriptions WHERE id = ${r.id}`;
        removed++;
      } else {
        failed++;
        console.error('push send failed', code, e && e.message);
      }
    }
  }
  return { sent, failed, removed };
}
