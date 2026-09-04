import crypto from 'node:crypto';
import { sql } from '../_lib/db.js';
import { send, getBody, sameOrigin } from '../_lib/http.js';
import { verifyPassword, createSession, hashToken } from '../_lib/auth.js';
import { verifyTotp, decryptSecret, hashRecoveryCode } from '../_lib/totp.js';

const MAX_FAILS = 10;
const LOCK_MINUTES = 15;
const MFA_TICKET_MINUTES = 5;
const MFA_MAX_ATTEMPTS = 5;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const body = await getBody(req);

  // Step 2 of an MFA login: a ticket from step 1 + a TOTP or recovery code.
  if (body && body.ticket) return completeMfaLogin(res, body);

  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return send(res, 400, { error: 'Escribe usuario y contraseña' });

  const rows = await sql`
    SELECT id, username, password_hash, role, active, failed_attempts, locked_until, totp_enabled
    FROM users WHERE lower(username) = lower(${username})
  `;
  const user = rows[0];

  if (user && user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return send(res, 423, { error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta en unos minutos.' });
  }

  const ok = user && verifyPassword(password, user.password_hash);

  if (!user || !ok) {
    if (user) {
      const fails = (user.failed_attempts || 0) + 1;
      const lock = fails >= MAX_FAILS
        ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString()
        : null;
      await sql`UPDATE users SET failed_attempts = ${fails}, locked_until = ${lock} WHERE id = ${user.id}`;
    }
    await new Promise((r) => setTimeout(r, 400)); // slow down brute force
    return send(res, 401, { error: 'Usuario o contraseña incorrectos' });
  }

  if (!user.active) {
    return send(res, 403, { error: 'Tu acceso está desactivado. Contacta al administrador.' });
  }

  await sql`UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ${user.id}`;

  // Only admin accounts can have MFA, and only if they've turned it on.
  if (user.role === 'admin' && user.totp_enabled) {
    await sql`DELETE FROM mfa_challenges WHERE expires_at < now()`; // opportunistic cleanup
    const ticket = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + MFA_TICKET_MINUTES * 60000);
    await sql`
      INSERT INTO mfa_challenges (token_hash, user_id, expires_at)
      VALUES (${hashToken(ticket)}, ${user.id}, ${expires.toISOString()})
    `;
    return send(res, 200, { mfaRequired: true, ticket });
  }

  await sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;
  await createSession(res, user.id);
  return send(res, 200, { username: user.username, role: user.role });
}

async function completeMfaLogin(res, body) {
  const ticket = String(body.ticket || '');
  const code = String(body.code || '').trim();
  if (!ticket || !code) return send(res, 400, { error: 'Falta el código' });

  const th = hashToken(ticket);
  const rows = await sql`
    SELECT c.attempts, c.expires_at, u.id AS user_id, u.username, u.role, u.active,
           u.totp_secret, u.totp_recovery_codes
    FROM mfa_challenges c JOIN users u ON u.id = c.user_id
    WHERE c.token_hash = ${th}
  `;
  const row = rows[0];
  if (!row) return send(res, 401, { error: 'Sesión de verificación inválida. Inicia sesión de nuevo.' });

  if (new Date(row.expires_at).getTime() < Date.now() || row.attempts >= MFA_MAX_ATTEMPTS) {
    await sql`DELETE FROM mfa_challenges WHERE token_hash = ${th}`;
    return send(res, 401, { error: 'El código expiró o hubo demasiados intentos. Inicia sesión de nuevo.' });
  }
  if (!row.active) {
    await sql`DELETE FROM mfa_challenges WHERE token_hash = ${th}`;
    return send(res, 403, { error: 'Tu acceso está desactivado.' });
  }

  let ok = false, usedRecovery = false;
  let codes = Array.isArray(row.totp_recovery_codes) ? row.totp_recovery_codes : [];
  if (row.totp_secret) {
    if (/^\d{6}$/.test(code)) {
      ok = verifyTotp(decryptSecret(row.totp_secret), code);
    } else {
      const h = hashRecoveryCode(code);
      const idx = codes.findIndex((c) => c.hash === h && !c.used_at);
      if (idx > -1) {
        ok = true;
        usedRecovery = true;
        codes = codes.map((c, i) => (i === idx ? { ...c, used_at: new Date().toISOString() } : c));
      }
    }
  }

  if (!ok) {
    await sql`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ${th}`;
    await new Promise((r) => setTimeout(r, 400));
    return send(res, 401, { error: 'Código incorrecto' });
  }

  if (usedRecovery) {
    await sql`UPDATE users SET totp_recovery_codes = ${JSON.stringify(codes)}::jsonb WHERE id = ${row.user_id}`;
  }
  await sql`DELETE FROM mfa_challenges WHERE token_hash = ${th}`;
  await sql`UPDATE users SET last_login_at = now() WHERE id = ${row.user_id}`;
  await createSession(res, row.user_id);
  return send(res, 200, { username: row.username, role: row.role });
}
