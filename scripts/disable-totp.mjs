// Emergency escape hatch: turns off TOTP 2FA for one account, in case the
// admin loses their phone AND their recovery codes. Run locally.
// Usage:
//   DATABASE_URL="postgres://..." node scripts/disable-totp.mjs <username>
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
const username = process.argv[2];
if (!username) {
  console.error('Uso: node scripts/disable-totp.mjs <usuario>');
  process.exit(1);
}
const sql = neon(url);

const rows = await sql.query(
  `UPDATE users
   SET totp_secret = NULL, totp_enabled = false, totp_recovery_codes = NULL
   WHERE lower(username) = lower($1)
   RETURNING username, totp_enabled`,
  [username]
);
if (!rows.length) {
  console.error(`No existe el usuario "${username}".`);
  process.exit(1);
}
console.log(`Verificación en dos pasos desactivada para "${rows[0].username}". Ya puede iniciar sesión solo con su contraseña.`);
