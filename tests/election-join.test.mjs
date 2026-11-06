// Public parser/transport fixtures only; no cryptography or network acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ELECTION_JOIN_FILE_LIMIT, encodeElectionJoinFile, decodeElectionJoinFile, readElectionJoinFile, validateElectionContext } from '../src/election-join.mjs';
import { parseKeyFileJson } from '../src/key-file-json.mjs';

const identity = Object.freeze({ networkId: 'preview', contractAddress: 'ab'.repeat(32), configurationDigest: 'cd'.repeat(32) });
const record = { schema: 'midnight-ballot-lab/election-join/v1', ...identity };

test('election join files round trip every allowed network with canonical public fields', async () => {
  for (const networkId of ['preview', 'preprod', 'undeployed']) {
    const input = Object.freeze({ ...identity, networkId, contractAddress: ` \t${identity.contractAddress.toUpperCase()}\n`,
      configurationDigest: ` ${identity.configurationDigest.toUpperCase()} ` });
    const text = encodeElectionJoinFile(input), expected = { ...record, networkId };
    assert.deepEqual(decodeElectionJoinFile(text, networkId), expected);
    assert.deepEqual(await readElectionJoinFile(new File([text], 'election-details.JSON'), networkId), expected);
    assert.deepEqual(Object.keys(JSON.parse(text)), ['schema', 'networkId', 'contractAddress', 'configurationDigest']);
    assert.ok(text.endsWith('\n'));
    assert.ok(Object.isFrozen(decodeElectionJoinFile(text, networkId)));
    assert.ok(input.contractAddress.includes('\t'), 'Encoding must not mutate the input');
  }
});

test('encoding explicitly projects public identity without reading or exporting unrelated caller data', () => {
  const input = { ...identity, administratorSecret: 'INERT-PRIVATE-FIXTURE' };
  Object.defineProperty(input, 'proofData', { enumerable: true, get() { throw new Error('Unrelated property must never be read'); } });
  Object.freeze(input);
  const text = encodeElectionJoinFile(input);
  assert.deepEqual(JSON.parse(text), record);
  assert.ok(!text.includes('INERT-PRIVATE-FIXTURE') && !text.includes('proofData'), 'Only public join fields may be serialized');
  assert.equal(input.administratorSecret, 'INERT-PRIVATE-FIXTURE');
  assert.deepEqual(validateElectionContext(input), identity);
  assert.ok(Object.isFrozen(validateElectionContext(input)));
});

test('shared transport accepts only exact flat fields, including a scalar trustee index', () => {
  const value = { context: 'public-fixture', index: 1 };
  assert.deepEqual(parseKeyFileJson(JSON.stringify(value), ['context', 'index']), value);
  for (const context of [{ nested: 'value' }, ['value']]) {
    assert.throws(() => parseKeyFileJson(JSON.stringify({ ...value, context }), ['context', 'index']));
  }
  assert.throws(() => parseKeyFileJson(JSON.stringify(value), ['context']));
  assert.throws(() => parseKeyFileJson(JSON.stringify(value), ['context', 'context']));
});

test('decoding rejects extra/private fields, missing fields, duplicate keys and unsupported schemas', () => {
  for (const field of ['administratorSecret', 'voterSecret', 'proofData', 'wallet', 'title', '__proto__', 'constructor']) {
    assert.throws(() => decodeElectionJoinFile(JSON.stringify({ ...record, [field]: 'INERT-PRIVATE-FIXTURE' }), 'preview'));
  }
  for (const field of Object.keys(record)) {
    const incomplete = { ...record }; delete incomplete[field];
    assert.throws(() => decodeElectionJoinFile(JSON.stringify(incomplete), 'preview'));
  }
  for (const value of [null, [], [record], 'text', { ...record, schema: 'midnight-ballot-lab/election-join/v2' }]) {
    assert.throws(() => decodeElectionJoinFile(JSON.stringify(value), 'preview'));
  }
  const duplicate = JSON.stringify(record).replace('"networkId":"preview"', '"networkId":"preview","networkId":"preview"');
  assert.throws(() => decodeElectionJoinFile(duplicate, 'preview'), /Duplicate/);
});

test('network matching is explicit and mainnet or ambiguous network labels never pass', () => {
  const text = encodeElectionJoinFile(identity);
  for (const expected of ['preprod', 'undeployed', 'mainnet', 'Preview', '', undefined, null]) {
    assert.throws(() => decodeElectionJoinFile(text, expected));
  }
  for (const networkId of ['mainnet', 'Preview', ' preview ', '', undefined, null, 1]) {
    assert.throws(() => encodeElectionJoinFile({ ...identity, networkId }));
    assert.throws(() => decodeElectionJoinFile(JSON.stringify({ ...record, networkId }), 'preview'));
  }
});

test('addresses and fingerprints require complete nonzero 32-byte hex values', () => {
  for (const field of ['contractAddress', 'configurationDigest']) {
    for (const value of [undefined, null, 123, '0'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(32) + ' ' + 'a'.repeat(32)]) {
      assert.throws(() => encodeElectionJoinFile({ ...identity, [field]: value }));
      assert.throws(() => decodeElectionJoinFile(JSON.stringify({ ...record, [field]: value }), 'preview'));
    }
  }
  assert.throws(() => encodeElectionJoinFile(Object.create(identity)));
  assert.throws(() => encodeElectionJoinFile(null));
  assert.throws(() => encodeElectionJoinFile([]));
});

test('JSON transport rejects truncation, trailing payload, excessive bytes and malformed Unicode', async () => {
  const text = encodeElectionJoinFile(identity);
  const padded = text + ' '.repeat(ELECTION_JOIN_FILE_LIMIT - new TextEncoder().encode(text).length);
  assert.deepEqual(decodeElectionJoinFile(padded, 'preview'), record);
  assert.throws(() => decodeElectionJoinFile(padded + ' ', 'preview'));
  for (const invalid of [text.slice(0, -3), text + '{}', '\ufeff' + text, '{"x":"' + 'é'.repeat(2050) + '"}', undefined]) {
    assert.throws(() => decodeElectionJoinFile(invalid, 'preview'));
  }
  for (const bytes of [new Uint8Array([0xff, 0xfe]), new Uint8Array([0xe2, 0x82])]) {
    await assert.rejects(readElectionJoinFile(new File([bytes], 'election.json'), 'preview'));
  }
});

test('file reader rejects invalid files and reported sizes without exposing names or read errors', async () => {
  const text = encodeElectionJoinFile(identity), data = new TextEncoder().encode(text).buffer;
  const privateMarker = 'WITHHELD-READ-ERROR';
  const invalid = [
    null, new File([text], 'identity.txt'), new File([], 'empty.json'),
    new File([' '.repeat(ELECTION_JOIN_FILE_LIMIT + 1)], 'large.json'),
    { name: privateMarker + '.json', size: data.byteLength, arrayBuffer: async () => { throw new Error(privateMarker); } },
    { name: 'identity.json', size: data.byteLength - 1, arrayBuffer: async () => data },
    { name: 'identity.json', size: 1, arrayBuffer: async () => new ArrayBuffer(ELECTION_JOIN_FILE_LIMIT + 1) },
    { name: 'identity.json', size: 1.5, arrayBuffer: async () => data },
    { name: 'identity.json', size: data.byteLength, arrayBuffer: async () => text },
  ];
  for (const file of invalid) {
    await assert.rejects(readElectionJoinFile(file, 'preview'), error => {
      assert.ok(!error.message.includes(privateMarker), 'Read errors must not expose file details');
      return true;
    });
  }
  await assert.rejects(readElectionJoinFile(new File([text], 'identity.json'), 'mainnet'));
});
