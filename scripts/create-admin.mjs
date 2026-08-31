// Creates (or promotes/resets) an admin user. You type the username and password;
// nothing is hard-coded.
// Usage:
//   DATABASE_URL="postgres://..." node scripts/create-admin.mjs
import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../api/_lib/passwords.js';
import readline from 'node:readline';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error('Falta DATABASE_URL.');
  process.exit(1);
}
const sql = neon(url);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    stdin.resume();
    if (stdin.setRawMode) stdin.setRawMode(true);
    let value = '';
    const onData = (buf) => {
      const s = buf.toString('utf8');
      for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10 || code === 4) {        // Enter / EOT
          if (stdin.setRawMode) stdin.setRawMode(wasRaw);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        } else if (code === 3) {                               // Ctrl-C
          if (stdin.setRawMode) stdin.setRawMode(wasRaw);
          process.stdout.write('\n');
          process.exit(1);
        } else if (code === 127 || code === 8) {               // Backspace / Delete
          value = value.slice(0, -1);
        } else if (code >= 32) {
          value += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}

const username = (await ask('Usuario admin: ')).trim();
if (!username) { console.error('Usuario vacio.'); process.exit(1); }

const p1 = await askHidden('Contrasena (minimo 8): ');
if (p1.length < 8) { console.error('Muy corta.'); process.exit(1); }
const p2 = await askHidden('Repite la contrasena: ');
if (p1 !== p2) { console.error('No coinciden.'); process.exit(1); }

const hash = hashPassword(p1);

try {
  const existing = await sql.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
  if (existing.length) {
    await sql.query(
      `UPDATE users
       SET password_hash = $1, role = 'admin', active = true, failed_attempts = 0, locked_until = NULL
       WHERE lower(username) = lower($2)`,
      [hash, username]
    );
    console.log(`\nUsuario "${username}" actualizado como admin.`);
  } else {
    await sql.query(
      `INSERT INTO users (username, password_hash, role, active) VALUES ($1, $2, 'admin', true)`,
      [username, hash]
    );
    console.log(`\nAdmin "${username}" creado.`);
  }
} catch (e) {
  console.error('\nError:', e.message);
  console.error('Ya ejecutaste "npm run init-db"?');
  process.exit(1);
}
