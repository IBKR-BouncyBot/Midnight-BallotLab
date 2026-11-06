import test from 'node:test';
import assert from 'node:assert/strict';
import { JUBJUB_SCALAR_ORDER } from '../contracts/native/adapter.mjs';
import { encodeTrusteeKeyFile, decodeTrusteeKeyFile, readTrusteeKeyFile, TRUSTEE_KEY_FILE_LIMIT } from '../src/trustee-key.mjs';

// Inert parser fixtures, never user keys or actual network credentials.
const context = Object.freeze({ networkId: 'preview', contractAddress: 'ab'.repeat(32), configurationDigest: 'cd'.repeat(32) });
const record = (patch = {}) => ({ schema: 'midnight-ballot-lab/trustee-key/v1', ...context,
  trusteeIndex: 1, secretShare: '18', ...patch });
const safeFailure = error => {
  assert.equal(error.message, 'Invalid private trustee key file or election context');
  assert.equal(error.cause, undefined);
  return true;
};

test('private trustee files round trip all indices with only the exact frozen schema', async () => {
  for (const trusteeIndex of [1, 2, 3]) {
    const value = record({ trusteeIndex });
    const text = encodeTrusteeKeyFile(value);
    assert.equal(text.endsWith('\n'), true);
    assert.deepEqual(JSON.parse(text), value);
    const decoded = decodeTrusteeKeyFile(text, context);
    assert.deepEqual(decoded, value);
    assert.ok(Object.isFrozen(decoded));
    assert.deepEqual(await readTrusteeKeyFile(new File([text], 'trustee.private.json'), context), value);
  }
});

test('trustee schema rejects missing, extra, ambiguous and non-data properties', () => {
  const missing = record(); delete missing.secretShare;
  const inherited = Object.create(record());
  const accessor = record(); Object.defineProperty(accessor, 'secretShare', { get: () => { throw new Error('Do not read'); } });
  for (const value of [missing, inherited, accessor, null, [], record({ schema: 'different' }),
    record({ administratorSecret: 'never-export' }), record({ witness: {} }), { ...record(), [Symbol('extra')]: true }]) {
    assert.throws(() => encodeTrusteeKeyFile(value), safeFailure);
  }
  const text = JSON.stringify(record());
  for (const bad of [text.replace('"secretShare":"18"', '"secretShare":"18","secretShare":"19"'),
    text.replace('"secretShare":"18"', '"secretShare":"18","secret\\u0053hare":"19"'),
    text.replace('"secretShare":"18"', '"secretShare":"18","__proto__":{}'),
    JSON.stringify({ ...record(), privateState: {} }), JSON.stringify({ ...record(), secretShare: { value: '18' } })]) {
    assert.throws(() => decodeTrusteeKeyFile(bad, context), safeFailure);
  }
});

test('trustee shares require canonical nonzero decimal subgroup scalars and integer indices', () => {
  for (const secretShare of ['1', String(JUBJUB_SCALAR_ORDER - 1n)]) {
    assert.equal(decodeTrusteeKeyFile(encodeTrusteeKeyFile(record({ secretShare })), context).secretShare, secretShare);
  }
  for (const secretShare of ['0', String(JUBJUB_SCALAR_ORDER), String(JUBJUB_SCALAR_ORDER + 1n), '-1', '+18', '018',
    '18 ', ' 18', '1.8', '1e1', '0x12', '', '9'.repeat(100), 18, 18n, null, true]) {
    assert.throws(() => encodeTrusteeKeyFile(record({ secretShare })), safeFailure);
  }
  for (const trusteeIndex of [0, 4, -1, 1.5, '1', 1n, null, true]) {
    assert.throws(() => encodeTrusteeKeyFile(record({ trusteeIndex })), safeFailure);
  }
  assert.throws(() => decodeTrusteeKeyFile(JSON.stringify(record()).replace('"trusteeIndex":1', '"trusteeIndex":1e0'), context), safeFailure);
});

test('trustee imports require the current network, contract and configured fingerprint', () => {
  const text = encodeTrusteeKeyFile(record());
  for (const expected of [undefined, null, {}, { ...context, networkId: 'preprod' }, { ...context, networkId: 'mainnet' },
    { ...context, contractAddress: 'ee'.repeat(32) }, { ...context, configurationDigest: 'ef'.repeat(32) },
    { ...context, configurationDigest: '0'.repeat(64) }]) {
    assert.throws(() => decodeTrusteeKeyFile(text, expected), safeFailure);
  }
  for (const patch of [{ networkId: 'undeployed' }, { contractAddress: 'ee'.repeat(32) }, { configurationDigest: 'ef'.repeat(32) },
    { networkId: 'mainnet' }, { contractAddress: '0'.repeat(64) }, { configurationDigest: 'f'.repeat(63) }]) {
    assert.throws(() => decodeTrusteeKeyFile(JSON.stringify(record(patch)), context), safeFailure);
  }
  // Public identifiers follow the same case/whitespace normalization as join files.
  assert.deepEqual(decodeTrusteeKeyFile(text, { ...context, contractAddress: ' ' + context.contractAddress.toUpperCase() + ' ' }), record());
});

test('trustee JSON bounds bytes, nesting and spelling before creating a record', () => {
  const text = encodeTrusteeKeyFile(record());
  assert.equal(TRUSTEE_KEY_FILE_LIMIT, 4096);
  assert.deepEqual(decodeTrusteeKeyFile(text.padEnd(TRUSTEE_KEY_FILE_LIMIT, ' '), context), record());
  for (const bad of [text.padEnd(TRUSTEE_KEY_FILE_LIMIT + 1, ' '), text + 'é'.repeat(2000), '\ufeff' + text,
    text + '{}', text.slice(0, -2), '[[]]', 'null', JSON.stringify({ ...record(), secretShare: [[[['18']]]] })]) {
    assert.throws(() => decodeTrusteeKeyFile(bad, context), safeFailure);
  }
});

test('trustee file reading rejects wrong types, sizes, UTF-8 and read failures without leaking contents', async () => {
  const text = encodeTrusteeKeyFile(record());
  const files = [new File([text], 'trustee.txt'), new File([], 'empty.json'),
    new File([' '.repeat(TRUSTEE_KEY_FILE_LIMIT + 1)], 'large.json'),
    new File([new Uint8Array([0xff, 0xfe])], 'invalid.json'), new File(['\ufeff' + text], 'bom.json'),
    { name: 'changed.json', size: 1, arrayBuffer: async () => new TextEncoder().encode(text).buffer },
    { name: 'wrong-buffer.json', size: 1, arrayBuffer: async () => new Uint8Array([0]) },
    { name: 'read-error.json', size: 1, arrayBuffer: async () => { throw new Error('PRIVATE CONTENT MUST NOT ESCAPE'); } }];
  for (const file of files) await assert.rejects(readTrusteeKeyFile(file, context), safeFailure);
  let read = false;
  await assert.rejects(readTrusteeKeyFile({ name: 'unbound.json', size: 1, arrayBuffer: async () => { read = true; } }, {}), safeFailure);
  assert.equal(read, false);
});
