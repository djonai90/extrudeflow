import crypto from 'node:crypto';
import { sql } from '../_lib/db.js';
import { send, sameOrigin, readRawBody, getBody } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

const MAX_BYTES = 1_500_000; // ~1.5 MB — generous after client-side resize
const OK_MIME = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    // lightweight usage report for the current user
    const rows = await sql`
      SELECT count(*)::int AS images, COALESCE(sum(size),0)::bigint AS bytes
      FROM images WHERE user_id = ${user.id}
    `;
    return send(res, 200, {
      images: rows[0].images,
      bytes: Number(rows[0].bytes),
      limitBytes: 500 * 1024 * 1024,
    });
  }

  // Garbage-collect: drop this user's images not referenced any more
  // (keeps anything uploaded in the last hour so fresh, still-unsaved photos survive).
  if (req.method === 'DELETE') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });
    const body = await getBody(req);
    const keep = Array.isArray(body.keep) ? body.keep.filter((x) => typeof x === 'string').slice(0, 5000) : [];
    await sql`
      DELETE FROM images
      WHERE user_id = ${user.id}
        AND created_at < now() - interval '1 hour'
        AND NOT (id = ANY(${keep}::text[]))
    `;
    return send(res, 200, { ok: true });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'Origen no permitido' });

  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!OK_MIME[mime]) return send(res, 415, { error: 'Formato no permitido (usa JPG, PNG o WebP)' });

  let buf;
  try {
    buf = await readRawBody(req, MAX_BYTES);
  } catch (e) {
    return send(res, e.httpStatus === 413 ? 413 : 400, { error: 'La imagen supera 1.5 MB' });
  }
  if (!buf || buf.length < 100) return send(res, 400, { error: 'Imagen vacía' });

  const id = crypto.randomBytes(16).toString('base64url');
  await sql`
    INSERT INTO images (id, user_id, mime, bytes, size)
    VALUES (${id}, ${user.id}, ${mime}, decode(${buf.toString('base64')}, 'base64'), ${buf.length})
  `;
  return send(res, 201, { id });
}
