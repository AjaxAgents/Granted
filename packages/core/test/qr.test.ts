// Proves the QR encoder by decoding its output with an independent reader (jsQR).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { qrEncode, qrToSvg, qrToPngBase64, type QrMatrix } from '../src/qr';

function decodeMatrix(m: QrMatrix, scale = 4, border = 4): string | null {
  const px = (m.size + border * 2) * scale;
  const data = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const my = Math.floor(y / scale) - border, mx = Math.floor(x / scale) - border;
    const dark = my >= 0 && my < m.size && mx >= 0 && mx < m.size && m.dark[my][mx];
    const i = (y * px + x) * 4; const v = dark ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  const r = jsQR(data, px, px, { inversionAttempts: 'dontInvert' });
  return r ? r.data : null;
}

test('Q01 gate pass code round-trips', () => {
  const m = qrEncode('DDC2-7KQX9M');
  assert.equal(m.version, 1);
  assert.equal(decodeMatrix(m), 'DDC2-7KQX9M');
});

test('Q02 every version 1-10 decodes (lengths 1..200)', () => {
  const seen = new Set<number>();
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -:/.';
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let len = 1; len <= 200; len += 3) {
    let s = ''; for (let i = 0; i < len; i++) s += chars[Math.floor(rnd() * chars.length)];
    const m = qrEncode(s); seen.add(m.version);
    assert.equal(decodeMatrix(m), s, 'length ' + len + ' version ' + m.version);
  }
  for (let v = 1; v <= 10; v++) assert.ok(seen.has(v), 'version ' + v + ' exercised');
});

test('Q03 non-ASCII text decodes (UTF-8)', () => {
  const s = 'Bus duct — Hall B · Andrés';
  assert.equal(decodeMatrix(qrEncode(s)), s);
});

test('Q04 text that is too long is refused clearly', () => {
  assert.throws(() => qrEncode('x'.repeat(300)), /too long/);
});

test('Q05 PNG output is a valid image that decodes', () => {
  const b64 = qrToPngBase64(qrEncode('DDC2-7KQX9M'), 8, 4);
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  assert.equal(png.width, (21 + 8) * 8);
  const r = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(r && r.data, 'DDC2-7KQX9M');
});

test('Q06 SVG output is well formed', () => {
  const svg = qrToSvg(qrEncode('DDC2-7KQX9M'), 4);
  assert.match(svg, /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.match(svg, /<\/svg>$/);
});
