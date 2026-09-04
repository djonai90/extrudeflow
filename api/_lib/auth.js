import crypto from 'node:crypto';
import { sql } from './db.js';
import { send } from './http.js';

export { hashPassword, verifyPassword } from './passwords.js';

const COOKIE = 'ef_session';
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400 * 1000;

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, value, maxAgeSec) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
  );
}

export async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_MS);
  await sql`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${expires.toISOString()})
  `;
  setCookie(res, token, SESSION_DAYS * 86400);
}

export function clearSession(res) {
  setCookie(res, '', 0);
}

// Returns { id, username, role } or null. Slides the expiry when needed.
export async function getUser(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;

  const rows = await sql`
    SELECT u.id, u.username, u.role, u.active, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
  `;
  const row = rows[0];
  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
    return null;
  }
  if (!row.active) return null;

  // Sliding expiration: only write once a day to avoid a DB write per request.
  if (new Date(row.expires_at).getTime() - Date.now() < SESSION_MS - 86400 * 1000) {
    const newExpires = new Date(Date.now() + SESSION_MS);
    await sql`UPDATE sessions SET expires_at = ${newExpires.toISOString()} WHERE token_hash = ${hashToken(token)}`;
    if (res) setCookie(res, token, SESSION_DAYS * 86400);
  }

  return { id: row.id, username: row.username, role: row.role };
}

export async function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${hashToken(token)}`;
}

// Guards. Return the user, or null after having sent the error response.
export async function requireUser(req, res) {
  const user = await getUser(req, res);
  if (!user) {
    send(res, 401, { error: 'No autenticado' });
    return null;
  }
  return user;
}

export async function requireAdmin(req, res) {
  const user = await getUser(req, res);
  if (!user) {
    send(res, 401, { error: 'No autenticado' });
    return null;
  }
  if (user.role !== 'admin') {
    send(res, 403, { error: 'Requiere permisos de administrador' });
    return null;
  }
  return user;
}
