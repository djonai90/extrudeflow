// Generates the PWA icons from a vector spec — pure Node, no dependencies.
// Run:  node scripts/gen-icons.mjs
import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

/* ---- tiny PNG encoder (8-bit RGBA) ---- */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function png(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                 // 8-bit, RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;              // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, png('IHDR', ihdr), png('IDAT', idat), png('IEND', Buffer.alloc(0))]);
}

/* ---- icon geometry (in a 512 box, relative to centre), rendered supersampled ---- */
const BG = [0x0d, 0x10, 0x0e];
const FG = [0x4a, 0xde, 0x80];

function render(size, glyphScale) {
  const ss = 4;
  const out = new Uint8Array(size * size * 4);
  const c = size / 2;
  const u = (size / 512) * glyphScale;         // unit scale
  const ringR = 116 * u, ringW = 30 * u, hubR = 34 * u, strandR = 15 * u;
  const ax = c + 42 * u, ay = c - 42 * u;        // strand start  (rel  42,-42)
  const bx = c + 116 * u, by = c - 116 * u;      // strand end    (rel 116,-116)

  const inside = (x, y) => {
    const d = Math.hypot(x - c, y - c);
    if (Math.abs(d - ringR) <= ringW / 2) return true;
    if (d <= hubR) return true;
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - (ax + t * vx), y - (ay + t * vy)) <= strandR;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++)
          if (inside(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss)) hit++;
      const a = hit / (ss * ss);
      const i = (y * size + x) * 4;
      out[i]     = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      out[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      out[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      out[i + 3] = 255;
    }
  }
  return encodePNG(size, out);
}

const targets = [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.72],   // logo kept inside the maskable safe zone
  ['apple-touch-icon.png', 180, 1],
];
for (const [name, size, k] of targets) {
  writeFileSync(new URL('../' + name, import.meta.url), render(size, k));
  console.log('  ok  ' + name + '  (' + size + 'px)');
}
console.log('\nIconos generados.');
