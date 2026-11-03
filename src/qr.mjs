/*
 * Fixed-version QR Model 2 encoder: version 8, ECC L, byte mode (ASCII only).
 * Adapted in part from the QRCode encoder shipped with ReportLab:
 * Copyright (c) 2009 Kazuhiko Arase
 * Copyright (c) 2014 Open End AB
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to
 * do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Narrow scope is deliberate: receipt payloads are ASCII. No network service,
 * URL, ballot choice, identity or cryptographic secret is added to a QR symbol.
 */

export const QR_VERSION = 8;
export const QR_CAPACITY_BYTES = 192;
const SIZE = 49;
const DATA_PER_BLOCK = 97;
const ECC_PER_BLOCK = 24;

const exp = new Uint8Array(512);
const log = new Uint8Array(256);
let gf = 1;
for (let i = 0; i < 255; i++) {
  exp[i] = gf;
  log[gf] = i;
  gf <<= 1;
  if (gf & 256) gf ^= 0x11d;
}
for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
function mul(a, b) { return a && b ? exp[log[a] + log[b]] : 0; }

function correction(data) {
  let generator = [1];
  for (let degree = 0; degree < ECC_PER_BLOCK; degree++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let i = 0; i < generator.length; i++) {
      next[i] ^= generator[i];
      next[i + 1] ^= mul(generator[i], exp[degree]);
    }
    generator = next;
  }
  const polynomial = [...data, ...new Array(ECC_PER_BLOCK).fill(0)];
  for (let i = 0; i < data.length; i++) {
    const leading = polynomial[i];
    if (leading) for (let j = 0; j < generator.length; j++) polynomial[i + j] ^= mul(leading, generator[j]);
  }
  return polynomial.slice(data.length);
}

function codewords(text) {
  if (typeof text !== 'string') throw new TypeError('QR input must be a string.');
  if (!/^[\x20-\x7e]*$/.test(text)) throw new RangeError('Receipt QR supports printable ASCII only.');
  if (text.length > QR_CAPACITY_BYTES) throw new RangeError(`Receipt QR supports at most ${QR_CAPACITY_BYTES} ASCII bytes.`);
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); // Byte mode; version 8 uses an 8-bit character count.
  put(text.length, 8);
  for (let i = 0; i < text.length; i++) put(text.charCodeAt(i), 8);
  put(0, 4);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
    data.push(value);
  }
  let pad = 0;
  while (data.length < DATA_PER_BLOCK * 2) data.push(pad++ % 2 ? 0x11 : 0xec);
  const blocks = [data.slice(0, DATA_PER_BLOCK), data.slice(DATA_PER_BLOCK)];
  const ecc = blocks.map(correction);
  const result = [];
  for (let i = 0; i < DATA_PER_BLOCK; i++) for (const block of blocks) result.push(block[i]);
  for (let i = 0; i < ECC_PER_BLOCK; i++) for (const block of ecc) result.push(block[i]);
  return result;
}

const masks = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
  (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
  (r, c) => ((r * c) % 3 + (r + c) % 2) % 2 === 0,
];

function bch(value, shift, divisor) {
  let remainder = value << shift;
  const degree = (n) => 31 - Math.clz32(n);
  while (remainder && degree(remainder) >= degree(divisor)) remainder ^= divisor << (degree(remainder) - degree(divisor));
  return (value << shift) | remainder;
}

function matrixFor(data, mask) {
  const m = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  function finder(row, col) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
      m[r][c] = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
        (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
    }
  }
  finder(0, 0); finder(SIZE - 7, 0); finder(0, SIZE - 7);
  for (const r of [6, 24, 42]) for (const c of [6, 24, 42]) {
    if (m[r][c] !== null) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      m[r + dr][c + dc] = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
    }
  }
  for (let i = 8; i < SIZE - 8; i++) {
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
  }
  const format = bch((1 << 3) | mask, 10, 0x537) ^ 0x5412; // ECC L = 01.
  for (let i = 0; i < 15; i++) {
    const value = !!((format >>> i) & 1);
    const vertical = i < 6 ? i : i < 8 ? i + 1 : SIZE - 15 + i;
    const horizontal = i < 8 ? SIZE - i - 1 : i === 8 ? 7 : 14 - i;
    m[vertical][8] = value;
    m[8][horizontal] = value;
  }
  m[SIZE - 8][8] = true;
  const version = bch(QR_VERSION, 12, 0x1f25);
  for (let i = 0; i < 18; i++) {
    const value = !!((version >>> i) & 1);
    m[Math.floor(i / 3)][i % 3 + SIZE - 11] = value;
    m[i % 3 + SIZE - 11][Math.floor(i / 3)] = value;
  }
  let upward = true, bit = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let i = 0; i < SIZE; i++) {
      const r = upward ? SIZE - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (m[r][c] !== null) continue;
        const value = bit < data.length * 8 ? !!((data[bit >>> 3] >>> (7 - (bit & 7))) & 1) : false;
        m[r][c] = value !== masks[mask](r, c);
        bit++;
      }
    }
    upward = !upward;
  }
  if (bit !== 1936) throw new Error('Internal QR placement error.');
  return m;
}

// QR mask penalty rules N1–N4. Correctness does not depend on which legal mask
// wins; selecting the lowest penalty improves scan reliability.
function score(m) {
  let penalty = 0, dark = 0;
  for (let axis = 0; axis < 2; axis++) for (let a = 0; a < SIZE; a++) {
    const line = Array.from({ length: SIZE }, (_, b) => axis ? m[b][a] : m[a][b]);
    let run = 1;
    for (let i = 1; i <= SIZE; i++) {
      if (i < SIZE && line[i] === line[i - 1]) run++;
      else { if (run >= 5) penalty += run - 2; run = 1; }
    }
    for (let i = 0; i + 10 < SIZE; i++) {
      const pattern = line.slice(i, i + 11).map(Number).join('');
      if (pattern === '10111010000' || pattern === '00001011101') penalty += 40;
    }
  }
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (m[r][c]) dark++;
    if (r && c && m[r][c] === m[r - 1][c] && m[r][c] === m[r][c - 1] && m[r][c] === m[r - 1][c - 1]) penalty += 3;
  }
  penalty += Math.floor(Math.abs(dark * 100 / (SIZE * SIZE) - 50) / 5) * 10;
  return penalty;
}

/** Return a 49x49 boolean module matrix, without its four-module quiet zone. */
export function qrMatrix(text, { mask } = {}) {
  const data = codewords(text);
  if (mask !== undefined) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new RangeError('QR mask must be an integer from 0 to 7.');
    return matrixFor(data, mask);
  }
  let best, minimum = Infinity;
  for (let i = 0; i < 8; i++) {
    const matrix = matrixFor(data, i), penalty = score(matrix);
    if (penalty < minimum) { minimum = penalty; best = matrix; }
  }
  return best;
}

/** Generate a self-contained SVG with a four-module quiet zone. No raw input
 *  is interpolated into markup. scale must be an integer from 1 to 16. */
export function qrSvg(text, { scale = 4 } = {}) {
  if (!Number.isInteger(scale) || scale < 1 || scale > 16) throw new RangeError('QR scale must be an integer from 1 to 16.');
  const m = qrMatrix(text);
  const side = SIZE + 8;
  let path = '';
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (m[r][c]) path += `M${c + 4},${r + 4}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${side * scale}" height="${side * scale}" viewBox="0 0 ${side} ${side}" role="img" aria-label="Ballot receipt QR code" shape-rendering="crispEdges"><rect width="${side}" height="${side}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
