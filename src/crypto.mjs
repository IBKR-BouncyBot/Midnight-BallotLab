/**
 * Research cryptography for the local Ballot Lab demonstration.
 * NOT audited, NOT constant-time, NOT an ElectionGuard implementation, and
 * NOT the cryptographic format accepted by the separate Compact contract.
 * Group: RFC 3526 section 3, 2048-bit MODP group 14, prime-order subgroup <2>.
 * Sources: https://www.rfc-editor.org/rfc/rfc3526#section-3
 *          https://www.usenix.org/system/files/usenixsecurity24-benaloh.pdf
 */
export const GROUP_ID = 'rfc3526-group14-q-subgroup';
export const P = BigInt('0x' + [
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1',
  '29024E088A67CC74020BBEA63B139B22514A08798E3404DD',
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245',
  'E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED',
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D',
  'C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F',
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D',
  '670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B',
  'E39E772C180E8603 9B2783A2EC07A28FB5C55DF06F4C52C9',
  'DE2BCBF6955817183995497CEA956AE515D2261898FA0510',
  '15728E5A8AACAA68FFFFFFFFFFFFFFFF',
].join('').replaceAll(' ', ''));
export const Q = (P - 1n) / 2n;
export const G = 2n;
export const HEX_WIDTH = 512;
const encoder = new TextEncoder();

export function requireCondition(ok, message) { if (!ok) throw new Error(message); }

export function mod(x, modulus = P) { const r = x % modulus; return r < 0n ? r + modulus : r; }

export function pow(base, exponent, modulus = P) {
  requireCondition(typeof exponent === 'bigint' && exponent >= 0n, 'Invalid exponent');
  let result = 1n;
  let b = mod(base, modulus);
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = result * b % modulus;
    b = b * b % modulus;
  }
  return result;
}

export function inverse(value, modulus = P) {
  let a = mod(value, modulus), b = modulus, u = 1n, v = 0n;
  requireCondition(a !== 0n, 'Cannot invert zero');
  while (b !== 0n) {
    const k = a / b;
    [a, b] = [b, a - k * b];
    [u, v] = [v, u - k * v];
  }
  requireCondition(a === 1n, 'Non-invertible value');
  return mod(u, modulus);
}

export function hex(value) {
  requireCondition(typeof value === 'bigint' && value >= 0n && value < (1n << 2048n), 'Invalid encoded integer');
  return value.toString(16).padStart(HEX_WIDTH, '0');
}

export function parseHex(value, label = 'integer') {
  requireCondition(typeof value === 'string' && /^[0-9a-f]{512}$/.test(value), `${label}: expected canonical 512-digit lowercase hex`);
  return BigInt('0x' + value);
}

export function scalar(value, label = 'scalar', nonzero = false) {
  const n = parseHex(value, label);
  requireCondition(n < Q && (!nonzero || n > 0n), `${label}: scalar out of range`);
  return n;
}

const subgroupCache = new Map();
export function element(value, label = 'group element', nonidentity = false) {
  const n = parseHex(value, label);
  requireCondition(n > 0n && n < P && (!nonidentity || n !== 1n), `${label}: group element out of range`);
  let valid = subgroupCache.get(value);
  if (valid === undefined) {
    valid = pow(n, Q) === 1n;
    if (subgroupCache.size >= 4096) subgroupCache.clear();
    subgroupCache.set(value, valid);
  }
  requireCondition(valid, `${label}: not in prime-order subgroup`);
  return n;
}

export function objectKeys(object, expected, label = 'object') {
  requireCondition(object !== null && typeof object === 'object' && !Array.isArray(object), `${label}: expected object`);
  const got = Object.keys(object).sort();
  requireCondition(got.length === expected.length && got.every((key, i) => key === [...expected].sort()[i]), `${label}: unexpected or missing fields`);
}

export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireCondition(Number.isSafeInteger(value) && !Object.is(value, -0), 'Only canonical safe integers are supported');
    return String(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  requireCondition(value && Object.getPrototypeOf(value) === Object.prototype, 'Only plain JSON values are supported');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export async function hash(domain, ...values) {
  requireCondition(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues, 'WebCrypto is required; use HTTPS or localhost');
  const data = encoder.encode(canonical(['midnight-ballot-lab-v1', domain, ...values]));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function challenge(domain, ...values) { return BigInt('0x' + await hash(domain, ...values)); }

export function randomScalar(nonzero = false) {
  requireCondition(globalThis.crypto?.getRandomValues, 'A cryptographically secure random generator is required');
  for (;;) {
    const bytes = new Uint8Array(256);
    globalThis.crypto.getRandomValues(bytes);
    bytes[0] &= 0x7f;
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    if (n < Q && (!nonzero || n !== 0n)) return n;
  }
}

/** Prove log_G(y) = log_base(target), Fiat-Shamir binding all statements. */
export async function proveDLEQ(domain, context, base, y, target, witness) {
  requireCondition(pow(G, witness) === y && pow(base, witness) === target, 'DLEQ witness does not match statement');
  const w = randomScalar(true);
  const t1 = pow(G, w), t2 = pow(base, w);
  const c = await challenge(domain, context, hex(base), hex(y), hex(target), hex(t1), hex(t2));
  return { c: hex(c), z: hex(mod(w + c * witness, Q)) };
}

export async function verifyDLEQ(domain, context, base, y, target, proof) {
  objectKeys(proof, ['c', 'z'], 'DLEQ proof');
  const c = scalar(proof.c, 'DLEQ challenge'), z = scalar(proof.z, 'DLEQ response');
  const t1 = mod(pow(G, z) * inverse(pow(y, c)));
  const t2 = mod(pow(base, z) * inverse(pow(target, c)));
  const expected = await challenge(domain, context, hex(base), hex(y), hex(target), hex(t1), hex(t2));
  requireCondition(c === expected, 'DLEQ proof failed');
}

/** OR proof that ElGamal (a,b) encrypts 0 OR 1 under y. */
export async function proveBit(context, y, a, b, bit, randomness) {
  requireCondition(bit === 0 || bit === 1, 'Bit proof requires 0 or 1');
  requireCondition(pow(G, randomness) === a && mod(pow(y, randomness) * pow(G, BigInt(bit))) === b, 'Bit proof witness mismatch');
  const real = bit, fake = 1 - bit;
  const c = [0n, 0n], z = [0n, 0n], t1 = [0n, 0n], t2 = [0n, 0n];
  c[fake] = randomScalar(); z[fake] = randomScalar();
  const fakeTarget = mod(b * inverse(pow(G, BigInt(fake))));
  t1[fake] = mod(pow(G, z[fake]) * inverse(pow(a, c[fake])));
  t2[fake] = mod(pow(y, z[fake]) * inverse(pow(fakeTarget, c[fake])));
  const w = randomScalar(true);
  t1[real] = pow(G, w); t2[real] = pow(y, w);
  const total = await challenge('bit-or', context, hex(y), hex(a), hex(b), t1.map(hex), t2.map(hex));
  c[real] = mod(total - c[fake], Q); z[real] = mod(w + c[real] * randomness, Q);
  return { c0: hex(c[0]), z0: hex(z[0]), c1: hex(c[1]), z1: hex(z[1]) };
}

export async function verifyBit(context, y, a, b, proof) {
  objectKeys(proof, ['c0', 'z0', 'c1', 'z1'], 'Bit proof');
  const c = [scalar(proof.c0), scalar(proof.c1)], z = [scalar(proof.z0), scalar(proof.z1)];
  const t1 = [], t2 = [];
  for (let m = 0; m < 2; m++) {
    const target = mod(b * inverse(pow(G, BigInt(m))));
    t1.push(mod(pow(G, z[m]) * inverse(pow(a, c[m]))));
    t2.push(mod(pow(y, z[m]) * inverse(pow(target, c[m]))));
  }
  const expected = await challenge('bit-or', context, hex(y), hex(a), hex(b), t1.map(hex), t2.map(hex));
  requireCondition(mod(c[0] + c[1], Q) === expected, 'Ballot bit proof failed');
}

export async function sign(context, publicKey, secret) {
  requireCondition(pow(G, secret) === publicKey, 'Signing secret does not match credential');
  const w = randomScalar(true), commitment = pow(G, w);
  const c = await challenge('credential-signature', context, hex(publicKey), hex(commitment));
  return { c: hex(c), z: hex(mod(w + c * secret, Q)) };
}

export async function verifySignature(context, publicKey, signature) {
  objectKeys(signature, ['c', 'z'], 'Credential signature');
  const c = scalar(signature.c), z = scalar(signature.z);
  const commitment = mod(pow(G, z) * inverse(pow(publicKey, c)));
  requireCondition(c === await challenge('credential-signature', context, hex(publicKey), hex(commitment)), 'Credential signature failed');
}

export function lagrangeAtZero(index, indices) {
  let result = 1n;
  for (const other of indices) if (other !== index) result = mod(result * BigInt(other) * inverse(BigInt(other - index), Q), Q);
  return result;
}

export function boundedDiscreteLog(value, bound) {
  requireCondition(Number.isSafeInteger(bound) && bound >= 0 && bound <= 1000, 'Invalid tally bound');
  let current = 1n;
  for (let i = 0; i <= bound; i++) {
    if (current === value) return i;
    current = current * G % P;
  }
  throw new Error('Decrypted tally is outside the accepted ballot count');
}
