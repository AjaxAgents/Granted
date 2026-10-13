/*
 * Granted — QR code encoder (no libraries, no outside services).
 *
 * Byte mode, error correction level M (about 15% damage tolerance), versions
 * 1-10 (up to 213 bytes). A gate pass code needs about 10 bytes. Follows
 * ISO/IEC 18004; test/qr.test.ts proves it by decoding the output with an
 * independent reader (jsQR). The same encoder runs as an Office Script in the
 * Power Apps edition (GrantedPA).
 */
export interface QrMatrix {
  version: number;
  size: number;
  mask: number;
  dark: boolean[][]; // dark[row][col]
}

// Error correction level M, versions 1-10:
// [ec codewords per block, group-1 blocks, group-1 data codewords, group-2 blocks, group-2 data codewords]
const QR_ECC_M: number[][] = [
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44],
];
const QR_ALIGN: number[][] = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

function qrUtf8(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function qrGfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function qrRsDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = qrGfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = qrGfMul(root, 0x02);
  }
  return result;
}

function qrRsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map((): number => 0);
  for (let k = 0; k < data.length; k++) {
    const first = result.shift();
    const factor = data[k] ^ (first === undefined ? 0 : first);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= qrGfMul(divisor[i], factor);
  }
  return result;
}

function qrDataCapacity(version: number): number {
  const t = QR_ECC_M[version - 1];
  return t[1] * t[2] + t[3] * t[4];
}

function qrBuildCodewords(bytes: number[], version: number): number[] {
  const capBits = qrDataCapacity(version) * 8;
  const bits: number[] = [];
  const put = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  put(0x4, 4); // byte mode
  put(bytes.length, version < 10 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);
  put(0, Math.min(4, capBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  // Split into blocks, add error correction, interleave.
  const t = QR_ECC_M[version - 1];
  const divisor = qrRsDivisor(t[0]);
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  let pos = 0;
  for (let g = 0; g < 2; g++) {
    const count = g === 0 ? t[1] : t[3];
    const len = g === 0 ? t[2] : t[4];
    for (let b = 0; b < count; b++) {
      const block = data.slice(pos, pos + len);
      pos += len;
      blocks.push(block);
      eccs.push(qrRsRemainder(block, divisor));
    }
  }
  const out: number[] = [];
  const maxLen = Math.max(t[2], t[4]);
  for (let i = 0; i < maxLen; i++) for (let b = 0; b < blocks.length; b++) if (i < blocks[b].length) out.push(blocks[b][i]);
  for (let i = 0; i < t[0]; i++) for (let b = 0; b < eccs.length; b++) out.push(eccs[b][i]);
  return out;
}

function qrMaskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function qrPenalty(m: boolean[][]): number {
  const n = m.length;
  let score = 0;
  // Rule 1: runs of 5+ same-colour modules in a row or column.
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        const cur = pass === 0 ? m[a][b] : m[b][a];
        const prev = pass === 0 ? m[a][b - 1] : m[b - 1][a];
        if (cur === prev) run++;
        else { if (run >= 5) score += run - 2; run = 1; }
      }
      if (run >= 5) score += run - 2;
    }
  }
  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
  }
  // Rule 3: finder-like patterns 1011101 with four light modules on one side.
  const p1 = [true, false, true, true, true, false, true, false, false, false, false];
  const p2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) for (let b = 0; b + 11 <= n; b++) {
      let hit1 = true;
      let hit2 = true;
      for (let k = 0; k < 11; k++) {
        const v = pass === 0 ? m[a][b + k] : m[b + k][a];
        if (v !== p1[k]) hit1 = false;
        if (v !== p2[k]) hit2 = false;
      }
      if (hit1) score += 40;
      if (hit2) score += 40;
    }
  }
  // Rule 4: balance of dark and light.
  let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) dark++;
  const total = n * n;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += Math.max(0, k) * 10;
  return score;
}

export function qrEncode(text: string): QrMatrix {
  const bytes = qrUtf8(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const need = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (need <= qrDataCapacity(v) * 8) { version = v; break; }
  }
  if (version === 0) throw new Error('Text too long for a version 1-10 QR code (max about 213 bytes).');
  const size = version * 4 + 17;
  const dark: boolean[][] = [];
  const fixed: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const r1: boolean[] = [];
    const r2: boolean[] = [];
    for (let x = 0; x < size; x++) { r1.push(false); r2.push(false); }
    dark.push(r1);
    fixed.push(r2);
  }
  const setFn = (x: number, y: number, isDark: boolean): void => { dark[y][x] = isDark; fixed[y][x] = true; };

  // Timing patterns
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  // Finder patterns with separators
  const finder = (cx: number, cy: number): void => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = cx + dx;
      const yy = cy + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, d !== 2 && d !== 4);
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  // Alignment patterns
  const al = QR_ALIGN[version - 1];
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format bits (written for real after masking) and version bits
  const drawFormat = (mask: number): void => {
    const data = (0 << 3) | mask; // level M = 00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true); // dark module
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const isDark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, isDark);
      setFn(b, a, isDark);
    }
  }
  // Data
  const codewords = qrBuildCodewords(bytes, version);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y][x] && bitIndex < codewords.length * 8) {
          dark[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
      }
    }
  }
  // Choose the mask with the lowest penalty
  const applyMask = (mask: number): void => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && qrMaskBit(mask, x, y)) dark[y][x] = !dark[y][x];
  };
  let best = 0;
  let bestScore = -1;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormat(mask);
    const sc = qrPenalty(dark);
    if (bestScore < 0 || sc < bestScore) { best = mask; bestScore = sc; }
    applyMask(mask); // undo
  }
  applyMask(best);
  drawFormat(best);
  return { version: version, size: size, mask: best, dark: dark };
}

/** SVG with a quiet zone of `border` modules. Scales to any size. */
export function qrToSvg(m: QrMatrix, border: number): string {
  const dim = m.size + border * 2;
  let path = '';
  for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) {
    if (m.dark[y][x]) path += 'M' + (x + border) + ',' + (y + border) + 'h1v1h-1z';
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges">' +
    '<rect width="100%" height="100%" fill="#ffffff"/><path d="' + path + '" fill="#000000"/></svg>';
}

// ---- PNG output (1-bit greyscale, uncompressed deflate) ----
function qrCrcTable(): number[] {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
}
function qrCrc32(bytes: number[], table: number[]): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function qrU32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function qrBase64(bytes: number[]): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? chars[(n >>> 6) & 63] : '=';
    out += i + 2 < bytes.length ? chars[n & 63] : '=';
  }
  return out;
}

/** PNG as base64 (for email attachments). `scale` pixels per module. */
export function qrToPngBase64(m: QrMatrix, scale: number, border: number): string {
  const px = (m.size + border * 2) * scale;
  const rowBytes = Math.ceil(px / 8);
  const raw: number[] = [];
  for (let py = 0; py < px; py++) {
    raw.push(0); // filter: none
    const my = Math.floor(py / scale) - border;
    for (let bx = 0; bx < rowBytes; bx++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pxX = bx * 8 + bit;
        const mx = Math.floor(pxX / scale) - border;
        const isDark = pxX < px && my >= 0 && my < m.size && mx >= 0 && mx < m.size && m.dark[my][mx];
        byte = (byte << 1) | (isDark ? 0 : 1); // 1 = white
      }
      raw.push(byte);
    }
  }
  // zlib stream using stored (uncompressed) deflate blocks
  const z: number[] = [0x78, 0x01];
  for (let i = 0; i < raw.length; i += 65535) {
    const len = Math.min(65535, raw.length - i);
    z.push(i + len >= raw.length ? 1 : 0, len & 255, (len >>> 8) & 255, ~len & 255, (~len >>> 8) & 255);
    for (let k = 0; k < len; k++) z.push(raw[i + k]);
  }
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < raw.length; i++) { s1 = (s1 + raw[i]) % 65521; s2 = (s2 + s1) % 65521; }
  const adler = ((s2 << 16) | s1) >>> 0;
  const ad = qrU32(adler);
  for (let i = 0; i < 4; i++) z.push(ad[i]);

  const table = qrCrcTable();
  const out: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
  const chunk = (type: string, data: number[]): void => {
    const typeBytes: number[] = [];
    for (let i = 0; i < 4; i++) typeBytes.push(type.charCodeAt(i));
    const len = qrU32(data.length);
    for (let i = 0; i < 4; i++) out.push(len[i]);
    const body = typeBytes.concat(data);
    for (let i = 0; i < body.length; i++) out.push(body[i]);
    const crc = qrU32(qrCrc32(body, table));
    for (let i = 0; i < 4; i++) out.push(crc[i]);
  };
  chunk('IHDR', qrU32(px).concat(qrU32(px), [1, 0, 0, 0, 0])); // 1-bit greyscale
  chunk('IDAT', z);
  chunk('IEND', []);
  return qrBase64(out);
}
