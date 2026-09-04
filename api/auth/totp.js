import { sql } from '../_lib/db.js';
import { send, getBody, sameOrigin } from '../_lib/http.js';
import { requireAdmin } from '../_lib/auth.js';
import {
  randomBase32Secret, verifyTotp, otpauthURI,
  generateRecoveryCodes, hashRecoveryCode,
  encryptSecret, decryptSecret,
} from '../_lib/totp.js';

// Manages TOTP (Google Authenticator-compatible) 2FA for the caller's own
// account. Admin-only by design — regular users never see or hit this.
export default async function handler(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const rows = await sql`SELECT totp_enabled FROM users WHERE id = ${user.id}`;
    return send(res, 200, { enabled: !!(rows[0] && rows[0].totp_enabled) });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const body = await getBody(req);
  const action = body && body.action;

  if (action === 'setup') {
    const secret = randomBase32Secret();
    let enc;
    try { enc = encryptSecret(secret); }
    catch (e) { return send(res, 503, { error: 'Verificación en dos pasos no configurada en el servidor' }); }
    await sql`
      UPDATE users SET totp_secret = ${enc}, totp_enabled = false, totp_recovery_codes = NULL
      WHERE id = ${user.id}
    `;
    return send(res, 200, { secret, otpauth: otpauthURI(secret, user.username) });
  }

  if (action === 'confirm') {
    const rows = await sql`SELECT totp_secret FROM users WHERE id = ${user.id}`;
    const enc = rows[0] && rows[0].totp_secret;
    if (!enc) return send(res, 400, { error: 'Primero genera una clave con "Configurar".' });
    const secret = decryptSecret(enc);
    if (!verifyTotp(secret, body.code)) {
      return send(res, 400, { error: 'Código incorrecto. Revisa la hora de tu teléfono e inténtalo de nuevo.' });
    }
    const codes = generateRecoveryCodes();
    const stored = codes.map((c) => ({ hash: hashRecoveryCode(c), used_at: null }));
    await sql`
      UPDATE users SET totp_enabled = true, totp_recovery_codes = ${JSON.stringify(stored)}::jsonb
      WHERE id = ${user.id}
    `;
    return send(res, 200, { ok: true, recoveryCodes: codes });
  }

  if (action === 'disable') {
    const rows = await sql`SELECT totp_secret, totp_enabled, totp_recovery_codes FROM users WHERE id = ${user.id}`;
    const row = rows[0];
    if (!row || !row.totp_enabled) return send(res, 200, { ok: true });

    const codeStr = String(body.code || '').trim();
    let ok = row.totp_secret && verifyTotp(decryptSecret(row.totp_secret), codeStr);
    if (!ok) {
      const h = hashRecoveryCode(codeStr);
      ok = (Array.isArray(row.totp_recovery_codes) ? row.totp_recovery_codes : [])
        .some((c) => c.hash === h && !c.used_at);
    }
    if (!ok) return send(res, 400, { error: 'Código incorrecto' });

    await sql`
      UPDATE users SET totp_secret = NULL, totp_enabled = false, totp_recovery_codes = NULL
      WHERE id = ${user.id}
    `;
    return send(res, 200, { ok: true });
  }

  return send(res, 400, { error: 'Acción inválida' });
}
