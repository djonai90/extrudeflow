import crypto from 'node:crypto';

// scrypt-based password hashing. No external dependency.
// Stored format: scrypt$<saltHex>$<hashHex>
const KEYLEN = 64;
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, KEYLEN, COST);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  let dk;
  try {
    dk = crypto.scryptSync(String(password), salt, expected.length, COST);
  } catch {
    return false;
  }
  return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
}
