/*
 * Hashing and randomness through Web Crypto, which Node 20+ and every browser
 * provide, so the same code runs on the API and in the offline demo.
 */

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('Web Crypto is not available');
  return c.subtle;
};
const enc = new TextEncoder();

export function b64(u8: Uint8Array): string {
  let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
export function unb64(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

export function randomBytes(n: number): Uint8Array<ArrayBuffer> { return globalThis.crypto.getRandomValues(new Uint8Array(n)); }
/** Uniform random number in [0, 1) from the system CSPRNG. Used for pass codes, project codes and email codes. */
export function secureRandom(): number { return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296; }

const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newId(prefix: string, length = 14): string {
  const bytes = randomBytes(length); let s = '';
  for (let i = 0; i < length; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return prefix + s;
}

export async function sha256Hex(s: string): Promise<string> {
  const h = await subtle().digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

/** Constant-time comparison of two strings of equal length. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export interface PasswordHash { hash: string; salt: string; iter: number }
export async function hashPassword(password: string, iterations: number): Promise<PasswordHash> {
  const salt = randomBytes(16);
  return { salt: b64(salt), iter: iterations, hash: b64(await pbkdf2(password, salt, iterations)) };
}
export async function checkPassword(password: string, h: PasswordHash): Promise<boolean> {
  return safeEqual(b64(await pbkdf2(password, unb64(h.salt), h.iter)), h.hash);
}

/*
 * The admin set-up code is stored only as a hash, in configuration (Key Vault
 * in production), never in this repository. Two formats are accepted:
 *   pbkdf2$<iterations>$<salt base64>$<hash base64>   (recommended; tools/admin-code-hash.mjs makes one)
 *   <64 hex chars> = SHA-256 of "granted-admin-v1:" + CODE   (the prototype format)
 */
export const ADMIN_CODE_PEPPER = 'granted-admin-v1:';
export async function matchesAdminCode(code: string, stored: string | undefined | null): Promise<boolean> {
  if (!code || !stored) return false;
  const s = stored.trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return safeEqual(await sha256Hex(ADMIN_CODE_PEPPER + code), s.toLowerCase());
  const m = /^pbkdf2\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(s);
  if (!m) return false;
  return safeEqual(b64(await pbkdf2(ADMIN_CODE_PEPPER + code, unb64(m[2]), Number(m[1]))), m[3]);
}
export async function makeAdminCodeHash(code: string, iterations = 600000): Promise<string> {
  const salt = randomBytes(16);
  return 'pbkdf2$' + iterations + '$' + b64(salt) + '$' + b64(await pbkdf2(ADMIN_CODE_PEPPER + code, salt, iterations));
}
