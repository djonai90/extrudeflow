import { neon } from '@neondatabase/serverless';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  // Surfaced clearly in function logs during setup.
  console.error('DATABASE_URL is not set. Configure it in Vercel > Project > Settings > Environment Variables.');
}

// HTTP one-shot query client — ideal for serverless. Usable as a tag:
//   await sql`SELECT ... WHERE id = ${id}`
// or as a plain call:
//   await sql.query('SELECT ... WHERE id = $1', [id])
export const sql = neon(connectionString || 'postgres://invalid');
