// Creates / updates the database schema. Idempotent — safe to run repeatedly.
// Usage:
//   DATABASE_URL="postgres://..." node scripts/init-db.mjs
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error('Falta DATABASE_URL. Ejemplo:\n  DATABASE_URL="postgres://usuario:pass@host/db?sslmode=require" node scripts/init-db.mjs');
  process.exit(1);
}
const sql = neon(url);

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
     id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
     username        text NOT NULL,
     password_hash   text NOT NULL,
     role            text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
     active          boolean NOT NULL DEFAULT true,
     failed_attempts integer NOT NULL DEFAULT 0,
     locked_until    timestamptz,
     last_login_at   timestamptz,
     created_at      timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username))`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now(),
     expires_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at)`,
  `CREATE TABLE IF NOT EXISTS user_data (
     user_id    bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     data       jsonb NOT NULL DEFAULT '{}'::jsonb,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
];

try {
  for (const stmt of statements) {
    await sql.query(stmt);
    console.log('  ok  ' + stmt.split('\n')[0].trim());
  }
  console.log('\nEsquema listo.');
} catch (e) {
  console.error('\nError al crear el esquema:', e.message);
  process.exit(1);
}
