import { sql } from '../_lib/db.js';
import { send } from '../_lib/http.js';
import { sendToUser, pushConfigured } from '../_lib/push.js';

const TZ = 'America/Mexico_City';
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const isPaid = (s) => /^\s*pagad/i.test(s || '');
const dedupKey = (banco, fecha) => `${banco}|${fecha}`;

function ymdInTZ(date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return `${+m[3]} ${MES[+m[2] - 1] || ''}`;
}
function money(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) || n === 0 ? '' : '$' + Math.round(n).toLocaleString('es-MX');
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!secret || auth !== `Bearer ${secret}`) return send(res, 401, { error: 'No autorizado' });
  if (!pushConfigured()) return send(res, 200, { ok: true, skipped: 'vapid-not-configured' });

  const now = new Date();
  // 2 días antes es el objetivo; 1 día antes queda como respaldo si Vercel se saltó un día.
  const d1 = ymdInTZ(new Date(now.getTime() + 1 * 86400000));
  const d2 = ymdInTZ(new Date(now.getTime() + 2 * 86400000));
  const windowDays = new Set([d1, d2]);

  // olvida marcas cuyo vencimiento ya pasó
  await sql`DELETE FROM payment_reminders_sent WHERE due_date < CURRENT_DATE`;

  const rows = await sql`
    SELECT user_id, data->'bancos' AS bancos
    FROM user_data
    WHERE data IS NOT NULL AND jsonb_exists(data, 'bancos')
  `;

  const summary = { checked: rows.length, notifiedUsers: 0, pushes: 0 };

  for (const row of rows) {
    const bancos = row.bancos;
    if (!bancos || !Array.isArray(bancos.periods) || !bancos.sheets) continue;

    const sentRows = await sql`SELECT dedup_key FROM payment_reminders_sent WHERE user_id = ${row.user_id}`;
    const alreadySent = new Set(sentRows.map((r) => r.dedup_key));

    // filas no pagadas que vencen en la ventana, sin duplicar banco+fecha
    const dueMap = new Map();
    for (const period of bancos.periods) {
      const sheet = bancos.sheets[period.id];
      if (!Array.isArray(sheet)) continue;
      for (const r of sheet) {
        const banco = (r.banco || '').trim();
        if (!banco || !windowDays.has(r.fecha) || isPaid(r.estado)) continue;
        const key = dedupKey(banco, r.fecha);
        if (alreadySent.has(key)) continue;
        if (!dueMap.has(key)) dueMap.set(key, { banco, fecha: r.fecha, pagoMin: r.pagoMin });
      }
    }
    if (!dueMap.size) continue;

    const items = [...dueMap.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
    const line = (it) => {
      const mm = money(it.pagoMin);
      return `${it.banco}: vence ${prettyDate(it.fecha)}${mm ? ` (pago mín. ${mm})` : ''}`;
    };
    const title = items.length === 1 ? 'Recordatorio de pago' : `${items.length} pagos por vencer`;
    const body = items.map(line).join(' · ');

    const result = await sendToUser(row.user_id, { title, body, url: '/', tag: 'ef-pay-reminder' });
    summary.pushes += result.sent;
    if (result.sent > 0) summary.notifiedUsers++;

    // marca como enviado aunque no haya suscripciones activas, para no reintentar cada día
    for (const [key, it] of dueMap) {
      await sql`
        INSERT INTO payment_reminders_sent (user_id, dedup_key, due_date)
        VALUES (${row.user_id}, ${key}, ${it.fecha})
        ON CONFLICT (user_id, dedup_key) DO NOTHING
      `;
    }
  }

  return send(res, 200, { ok: true, ...summary });
}
