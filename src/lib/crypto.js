// Funzioni crittografiche: codici di voto, password, verifica a due fattori (TOTP).
// Solo moduli integrati in Node.js, nessuna libreria esterna.
import crypto from 'node:crypto';

// Alfabeto senza caratteri ambigui (niente 0/O, 1/I/L). 31 simboli.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 12; // 31^12 ≈ 7,9·10^17 combinazioni (~59 bit)

function randomFromAlphabet(len, alphabet = ALPHABET) {
  // Rejection sampling: distribuzione uniforme, nessun bias da modulo.
  const out = [];
  const max = 256 - (256 % alphabet.length);
  while (out.length < len) {
    for (const b of crypto.randomBytes(len * 2)) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length === len) break;
    }
  }
  return out.join('');
}

export function generateCode() {
  return randomFromAlphabet(CODE_LENGTH);
}

export function formatCode(code) {
  return code.match(/.{1,4}/g).join('-');
}

// Normalizza quello che scrive l'utente: maiuscole, senza spazi e trattini.
export function normalizeCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .slice(0, 64);
}

export function isWellFormedCode(code) {
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

// Hash del codice: HMAC-SHA256 con chiave segreta del server e id della votazione.
// Senza la chiave segreta, l'hash non permette di provare codici a tappeto.
export function hashCode(secret, electionId, code) {
  return crypto.createHmac('sha256', secret).update(`${electionId}:${code}`).digest('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Parte casuale dell'indirizzo di voto, generata all'apertura (es. "k7p2xq").
export function generateSlug() {
  return randomFromAlphabet(6, 'abcdefghjkmnpqrstuvwxyz23456789');
}

// --- Password (scrypt) ---

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

// --- TOTP (RFC 6238), compatibile con Google Authenticator, Microsoft Authenticator, ecc. ---

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(str) {
  let bits = '';
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secret, timeMs, step = 30) {
  const counter = Math.floor(timeMs / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret, token, now = Date.now()) {
  const t = String(token ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t)) return false;
  // Tolleranza di ±30 secondi per orologi non perfettamente sincronizzati.
  return [-1, 0, 1].some((w) => totpAt(secret, now + w * 30_000) === t);
}

export function totpUri(secret, username, issuer = 'Voto Magnetico') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(username)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
