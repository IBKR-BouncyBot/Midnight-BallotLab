import test from 'node:test';
import assert from 'node:assert/strict';
import { getDiffieHellman } from 'node:crypto';
import {
  P, Q, G, HEX_WIDTH, hex, scalar, element, canonical, mod, pow, inverse,
  randomScalar, proveDLEQ, verifyDLEQ, proveBit, verifyBit, sign,
  verifySignature, lagrangeAtZero, boundedDiscreteLog,
} from '../src/crypto.mjs';

test('prime and generator exactly match the independent OpenSSL RFC 3526 group14 implementation', () => {
  const reference = getDiffieHellman('modp14');
  assert.equal(P.toString(16), reference.getPrime('hex'));
  assert.equal(G, BigInt(`0x${reference.getGenerator('hex')}`));
  assert.equal(P, 2n * Q + 1n);
  assert.equal(P.toString(2).length, 2048);
  assert.equal(pow(G, Q), 1n);
});

test('group validation rejects zero, p, p-1 and noncanonical encodings', () => {
  for (const bad of [hex(0n), hex(P), hex(P - 1n), '02', '0x02', 'A'.repeat(HEX_WIDTH)]) {
    assert.throws(() => element(bad));
  }
  assert.equal(element(hex(1n)), 1n, 'identity is valid for an empty aggregate');
  assert.throws(() => element(hex(1n), 'public key', true));
  assert.equal(element(hex(G), 'public key', true), G);
});

test('scalar validation applies canonical range and optional nonzero checks', () => {
  assert.equal(scalar(hex(0n)), 0n);
  assert.equal(scalar(hex(Q - 1n)), Q - 1n);
  assert.throws(() => scalar(hex(Q)));
  assert.throws(() => scalar(hex(0n), 'secret', true));
  assert.throws(() => scalar('1'));
});

test('canonical transcript encoding is order-independent and rejects unsupported values', () => {
  assert.equal(canonical({ z: 4, a: [1, true, null] }), canonical({ a: [1, true, null], z: 4 }));
  for (const bad of [NaN, Infinity, 0.2, -0, undefined, 2n, new Date(), Object.create(null)]) {
    assert.throws(() => canonical(bad));
  }
  assert.notEqual(canonical(['ab', 'c']), canonical(['a', 'bc']));
});

test('random scalars stay in subgroup order bounds with no fixed repeated output', () => {
  const values = Array.from({ length: 16 }, () => randomScalar(true));
  for (const value of values) assert.ok(value > 0n && value < Q);
  assert.equal(new Set(values.map(String)).size, values.length);
});

test('DLEQ proves equality of discrete logarithms and binds all context', async () => {
  const x = 17n, base = pow(G, 29n), y = pow(G, x), target = pow(base, x);
  const proof = await proveDLEQ('unit-dleq', { election: 'one' }, base, y, target, x);
  await verifyDLEQ('unit-dleq', { election: 'one' }, base, y, target, proof);
  await assert.rejects(() => verifyDLEQ('unit-dleq', { election: 'two' }, base, y, target, proof));
  await assert.rejects(() => verifyDLEQ('another-domain', { election: 'one' }, base, y, target, proof));
  await assert.rejects(() => verifyDLEQ('unit-dleq', { election: 'one' }, base, y, mod(target * G), proof));
  await assert.rejects(() => proveDLEQ('unit-dleq', {}, base, y, target, x + 1n));
});

test('OR proofs validate encrypted zero and one and reject invalid-bit witnesses', async () => {
  const y = pow(G, 31n), context = { election: 'bit-election', candidate: 2 };
  for (const bit of [0, 1]) {
    const r = randomScalar(true), a = pow(G, r), b = mod(pow(y, r) * pow(G, BigInt(bit)));
    const proof = await proveBit(context, y, a, b, bit, r);
    await verifyBit(context, y, a, b, proof);
    await assert.rejects(() => verifyBit({ ...context, candidate: 1 }, y, a, b, proof));
    await assert.rejects(() => verifyBit(context, y, a, mod(b * G), proof));
  }
  const r = 37n;
  await assert.rejects(() => proveBit(context, y, pow(G, r), mod(pow(y, r) * pow(G, 2n)), 2, r));
});

test('Schnorr signature binds payload, context and credential public key', async () => {
  const secret = 41n, publicKey = pow(G, secret);
  const context = { manifestHash: 'a'.repeat(64), ballot: 'original' };
  const signature = await sign(context, publicKey, secret);
  await verifySignature(context, publicKey, signature);
  await assert.rejects(() => verifySignature({ ...context, ballot: 'changed' }, publicKey, signature));
  await assert.rejects(() => verifySignature(context, pow(G, 43n), signature));
  await assert.rejects(() => sign(context, publicKey, secret + 1n));
});

test('Shamir Lagrange interpolation reconstructs secret for all two-of-three subsets', () => {
  const secret = 47n, coefficient = 53n;
  for (const indices of [[1, 2], [1, 3], [2, 3]]) {
    const reconstructed = mod(indices.reduce((sum, index) =>
      sum + lagrangeAtZero(index, indices) * mod(secret + coefficient * BigInt(index), Q), 0n), Q);
    assert.equal(reconstructed, secret);
  }
});

test('bounded discrete logarithm rejects out-of-range tallies', () => {
  assert.equal(boundedDiscreteLog(1n, 0), 0);
  assert.equal(boundedDiscreteLog(pow(G, 3n), 3), 3);
  assert.throws(() => boundedDiscreteLog(pow(G, 4n), 3));
  assert.throws(() => boundedDiscreteLog(pow(G, 3n), 1001));
  assert.throws(() => inverse(0n));
  assert.equal(mod(17n * inverse(17n)), 1n);
});
