import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJsonUtf8, parseStrictJson } from '../src/json.mjs';

test('strict JSON preserves ordinary public-record and receipt values', () => {
  const value = {
    schema: 'midnight-ballot-lab/native-receipt/v1', networkId: 'undeployed',
    configurationDigest: 'a'.repeat(64), receipt: 'b'.repeat(64),
    title: 'Research 🌙',
    escaped: 'A "quoted" label \\ slash\nline',
    nested: [{ tally: [2, 1, 2] }, { tally: [0, -1, 9007199254740991, -9007199254740991] }],
    enabled: true, disabled: false, empty: null,
  };
  assert.deepEqual(parseStrictJson(` \t\r\n${JSON.stringify(value)}\n`), value);
});

test('duplicate fields are rejected after decoding JSON key escapes', () => {
  for (const source of [
    '{"tally":[999],"tally":[1]}',
    '{"manifest":{"title":"Fake","title":"Real"}}',
    '{"a":1,"\\u0061":2}',
    '{"🌙":1,"\\ud83c\\udf19":2}',
    '{"__proto__":1,"__proto__":2}',
  ]) assert.throws(() => parseStrictJson(source), /Duplicate JSON object field/);
  assert.deepEqual(parseStrictJson('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
});

test('native object construction does not invoke the __proto__ setter', () => {
  const parsed = parseStrictJson('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert(Object.hasOwn(parsed, '__proto__'));
  assert.equal(parsed.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('public JSON transport rejects ambiguous number spellings', () => {
  for (const source of ['0.0', '1.000000000000000000001', '1e0', '1E+0', '1e-0']) {
    assert.throws(() => parseStrictJson(source), /Fractional or exponent-form/);
  }
  assert.throws(() => parseStrictJson('-0'), /Negative zero/);
  for (const source of ['9007199254740992', '-9007199254740992', '9'.repeat(1000)]) {
    assert.throws(() => parseStrictJson(source), /Unsafe JSON integer/);
  }
  for (const source of ['01', '-01', '+1', '--1', '-', 'NaN', 'Infinity']) {
    assert.throws(() => parseStrictJson(source), SyntaxError);
  }
});

test('malformed strings, containers and non-JSON whitespace are rejected', () => {
  for (const source of [
    '', '{', '[', '[1,]', '{"a":1,}', '{"a" 1}', '{a:1}',
    'true false', 'nullx', '[] /* comment */', '\u00a0{}',
    '"unterminated', '"raw\nnewline"', '"\\x41"', '"\\u12"', '"\\uZZZZ"',
  ]) assert.throws(() => parseStrictJson(source), SyntaxError, source);
  assert.equal(parseStrictJson('"\\ud800"'), '\ud800');
});

test('byte limits count UTF-8 rather than UTF-16 string length', () => {
  for (const [source, bytes] of [['"A"', 3], ['"é"', 4], ['"🌙"', 6]]) {
    assert.equal(parseStrictJson(source, { maxBytes: bytes }), JSON.parse(source));
    assert.throws(() => parseStrictJson(source, { maxBytes: bytes - 1 }), /byte limit/);
  }
  assert.throws(() => parseStrictJson('null', { maxBytes: 0 }), /Invalid JSON byte limit/);
});

test('nesting is capped before either parser can exhaust the call stack', () => {
  assert.equal(parseStrictJson('['.repeat(64) + '0' + ']'.repeat(64)).length, 1);
  assert.throws(() => parseStrictJson('['.repeat(65) + '0' + ']'.repeat(65)), /nesting limit/);
  assert.throws(() => parseStrictJson('{"a":{"b":0}}', { maxDepth: 1 }), /nesting limit/);
  assert.throws(() => parseStrictJson('[]', { maxDepth: 10000 }), /Invalid JSON nesting limit/);
});

test('UTF-8 decoding rejects malformed bytes and preserves a forbidden BOM', () => {
  const encoder = new TextEncoder();
  assert.equal(decodeJsonUtf8(encoder.encode('"🌙"')), '"🌙"');
  assert.throws(() => decodeJsonUtf8(Uint8Array.of(0x22, 0xff, 0x22)), /valid UTF-8/);
  assert.throws(() => decodeJsonUtf8(Uint8Array.of(0xc0, 0xaf)), /valid UTF-8/);
  assert.throws(() => decodeJsonUtf8(encoder.encode('null'), { maxBytes: 3 }), /byte limit/);
  const bom = Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d);
  assert.throws(() => parseStrictJson(decodeJsonUtf8(bom)), SyntaxError);
});
