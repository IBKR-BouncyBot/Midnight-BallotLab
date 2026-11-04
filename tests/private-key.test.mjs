import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrivateKey, privateKeyText, readPrivateKeyFile } from '../src/private-key.mjs';

// Inert parser fixtures, not wallet credentials or proof witnesses.
const key = 'a7'.repeat(32);

test('private key text round trips canonical nonzero bytes without extra metadata', async () => {
  const text = privateKeyText(key.toUpperCase());
  assert.equal(text, key + '\n');
  assert.equal(await readPrivateKeyFile(new File([text], 'administrator-key.private.txt')), key);
  assert.equal(normalizePrivateKey(' \r\n' + key + '\r\n'), key);
});

test('private key parser rejects zero, wrong sizes, embedded whitespace and public JSON', () => {
  for (const value of ['0'.repeat(64), key.slice(1), key + 'a', key.slice(0, 32) + ' ' + key.slice(32),
    'g'.repeat(64), JSON.stringify({ key }), key + '\u0000', null, new Uint8Array(32)]) {
    assert.throws(() => normalizePrivateKey(value));
  }
});

test('private key file import bounds size, encoding and type without exposing content', async () => {
  for (const file of [new File([key], 'public.json'), new File([], 'empty.txt'),
    new File([' '.repeat(257) + key], 'large.txt'), new File([new Uint8Array([0xff, 0xfe])], 'encoding.txt'),
    { name: 'size.txt', size: 65, arrayBuffer: async () => new ArrayBuffer(257) }]) {
    await assert.rejects(readPrivateKeyFile(file), error => {
      assert.ok(!String(error.message).includes(key));
      return true;
    });
  }
});
