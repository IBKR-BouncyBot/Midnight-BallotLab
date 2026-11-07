/** Transport/integrity boundaries only; these fixtures do not generate proofs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateNativeProverManifest, nativeProverAssetBase, nativeProverKeyLocation, loadNativeProvingAssets, proverAssetFailureCode,
  NATIVE_PROVER_CIRCUITS, NATIVE_PROVER_PARAMETERS, NATIVE_PROVER_PARAMETER_BYTES, NATIVE_PROVER_ASSET_SCHEMA,
} from '../contracts/native/wasm-prover-assets.mjs';
import { requireNoReportedExternalProver } from '../contracts/native/browser-config.mjs';

const asset = (path, bytes = 4, sha256 = 'a'.repeat(64)) => ({ path, bytes, sha256 });
function manifest() {
  return {
    schema: NATIVE_PROVER_ASSET_SCHEMA, proverVersion: '3.2.0',
    circuits: Object.entries(NATIVE_PROVER_CIRCUITS).map(([name, k]) => ({ name, k,
      prover: asset(`keys/${name}.prover`), verifier: asset(`keys/${name}.verifier`), ir: asset(`zkir/${name}.bzkir`),
    })),
    params: Object.entries(NATIVE_PROVER_PARAMETERS).map(([k, sha256]) => ({ k: Number(k),
      ...asset(`params/bls_midnight_2p${k}`, NATIVE_PROVER_PARAMETER_BYTES[k], sha256),
    })),
  };
}
const assetsUrl = 'https://app.example.test/repository/native-contract';
const workerUrl = 'https://app.example.test/repository/native-prover-worker.mjs';
const integrity = error => proverAssetFailureCode(error) === 'ASSET_INTEGRITY';
const hashBytes = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  n => n.toString(16).padStart(2, '0')).join('');
const manifestHash = input => hashBytes(new TextEncoder().encode(JSON.stringify(input)));

test('prover manifest binds every native circuit and the official SRS size/hash pins', () => {
  const input = manifest();
  const before = JSON.stringify(input);
  const parsed = validateNativeProverManifest(input);
  assert.equal(parsed.circuits.size, 7);
  assert.equal(parsed.params.size, 6);
  assert.equal(parsed.circuits.get('castBallot').k, 16);
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(parsed.circuits.get('castBallot')));
  for (const mutate of [
    value => { value.proverVersion = 'latest'; },
    value => { value.circuits[0].k = 7; },
    value => { value.circuits[0].prover.path = '../private'; },
    value => { value.circuits[0].prover.secret = 'unused'; },
    value => { value.circuits[0].prover.bytes = 129 * 1024 * 1024; },
    value => { value.circuits[1] = value.circuits[0]; },
    value => { value.params[0].sha256 = '0'.repeat(64); },
    value => { value.params[0].bytes++; },
    value => { value.params.pop(); },
    value => { value.privateState = {}; },
  ]) { const changed = manifest(); mutate(changed); assert.throws(() => validateNativeProverManifest(changed), integrity); }
});

test('prover public files cannot escape the same-origin asset directory', () => {
  assert.equal(nativeProverAssetBase(assetsUrl, workerUrl).href, assetsUrl);
  for (const value of ['https://remote.example.test/native-contract', `${assetsUrl}?token=x`, `${assetsUrl}#x`,
    'https://user:secret@app.example.test/native-contract', 'file:///native-contract', `${assetsUrl}/`]) {
    assert.throws(() => nativeProverAssetBase(value, workerUrl), integrity);
  }
});

test('SDK 5 key locations reject malformed, unrelated and wallet circuit requests', () => {
  const address = 'a'.repeat(64), verifier = 'b'.repeat(64);
  const key = `contract:${address}/castBallot?vk=${verifier}`;
  assert.deepEqual(nativeProverKeyLocation(key), { contractAddress: address, circuitId: 'castBallot', verifierKeyHash: verifier });
  assert.ok(Object.isFrozen(nativeProverKeyLocation(key)));
  assert.deepEqual(nativeProverKeyLocation('castBallot'), { circuitId: 'castBallot' });
  for (const value of [null, {}, '', 'constructor', 'midnight/dust/spend', 'dust/spend',
    `contract:${address}/other?vk=${verifier}`, `contract:${address}/castBallot`,
    key + '&secret=value', key + '#fragment', key.replace(verifier, 'B'.repeat(64)),
    key.replace(address, 'a'.repeat(63)), key.replace('/castBallot', '/..%2FcastBallot')]) {
    assert.throws(() => nativeProverKeyLocation(value), error => proverAssetFailureCode(error) === 'INVALID_REQUEST');
  }
});

test('canonical deployed key hashes must match the pinned manifest before material is fetched', async t => {
  const bytes = new Uint8Array([1, 2, 3, 4]), verifier = await hashBytes(bytes), input = manifest();
  for (const entry of input.circuits) for (const key of ['prover', 'verifier', 'ir']) entry[key].sha256 = verifier;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return new Response(url.endsWith('/prover-manifest.json') ? JSON.stringify(input) : bytes);
  });
  const source = await loadNativeProvingAssets(assetsUrl, workerUrl, await manifestHash(input));
  const prefix = `contract:${'a'.repeat(64)}/castBallot?vk=`;
  await assert.rejects(source.lookupKey(prefix + '0'.repeat(64)), integrity);
  assert.equal(requests.length, 1, 'A mismatched deployed key must not fetch any proving material');
  const actual = await source.lookupKey(prefix + verifier);
  assert.deepEqual(actual, { proverKey: bytes, verifierKey: bytes, ir: bytes });
  assert.equal(requests.length, 4);
  assert.ok(requests.every(url => !url.includes('contract:') && !url.includes('?')),
    'Contract addresses and key-location strings must not be sent in asset URLs');
});

test('manifest transport errors and malformed/duplicate JSON remain fixed safe failures', async t => {
  let response;
  t.mock.method(globalThis, 'fetch', async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  for (const input of [new Response('down', { status: 503 }), new Error('private sentinel URL')]) {
    response = input;
    await assert.rejects(loadNativeProvingAssets(assetsUrl, workerUrl, '0'.repeat(64)), error =>
      proverAssetFailureCode(error) === 'ASSET_UNAVAILABLE' && !error.message.includes('sentinel'));
  }
  for (const text of ['{"schema":"a","schema":"b"}', '[1]', 'null', '{', '\ufeff{}']) {
    response = new Response(text);
    await assert.rejects(loadNativeProvingAssets(assetsUrl, workerUrl, await hashBytes(new TextEncoder().encode(text))), integrity);
  }
  response = new Response(new Uint8Array([0xc3, 0x28]));
  await assert.rejects(loadNativeProvingAssets(assetsUrl, workerUrl, await hashBytes(new Uint8Array([0xc3, 0x28]))), integrity);
});

test('public asset bytes use actual SHA-256 verification and never POST', async t => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  const input = manifest();
  for (const entry of input.circuits) for (const key of ['prover', 'verifier', 'ir']) entry[key].sha256 = hash;
  const requests = [];
  let changed = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return new Response(url.endsWith('/prover-manifest.json') ? JSON.stringify(input) : changed ? new Uint8Array([4, 3, 2, 1]) : bytes);
  });
  const source = await loadNativeProvingAssets(assetsUrl, workerUrl, await manifestHash(input));
  const material = await source.lookupKey('castBallot');
  assert.deepEqual(material.ir, bytes);
  assert.equal(requests.length, 4);
  await source.lookupKey('castBallot');
  assert.equal(requests.length, 4, 'verified public bytes are cached in memory');
  assert.ok(requests.every(({ url, options }) => url.startsWith(`${assetsUrl}/`) && !options.method && !options.body
    && options.redirect === 'error' && options.credentials === 'omit'));
  changed = true;
  await assert.rejects(source.lookupKey('openVoting'), integrity);
  await assert.rejects(source.lookupKey('midnight/dust/spend'), error => proverAssetFailureCode(error) === 'INVALID_REQUEST');
  await assert.rejects(source.getParams(18), error => proverAssetFailureCode(error) === 'INVALID_REQUEST');
});

test('downloaded asset length is checked independently of HTTP headers', async t => {
  const input = manifest();
  t.mock.method(globalThis, 'fetch', async url => new Response(url.endsWith('/prover-manifest.json')
    ? JSON.stringify(input) : new Uint8Array([1, 2, 3, 4, 5])));
  const source = await loadNativeProvingAssets(assetsUrl, workerUrl, await manifestHash(input));
  await assert.rejects(source.lookupKey('enroll'), integrity);
});

test('a different self-consistent manifest cannot replace the manifest pinned into the worker', async t => {
  const input = manifest();
  const originalHash = await manifestHash(input);
  input.circuits[0].prover.sha256 = 'b'.repeat(64);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(input)));
  await assert.rejects(loadNativeProvingAssets(assetsUrl, workerUrl, originalHash), integrity);
  await assert.rejects(loadNativeProvingAssets(assetsUrl, workerUrl), integrity);
});

test('wallet URI absence is not an attestation and explicit server destinations fail closed', () => {
  for (const configuration of [{}, { proverServerUri: undefined }, { proverServerUri: null }, { proverServerUri: '' }]) {
    assert.equal(requireNoReportedExternalProver(configuration), 'not-reported');
  }
  for (const proverServerUri of ['http://localhost:6300', 'http://127.0.0.1:6300', 'https://remote.example.test', ' ', false, {}]) {
    assert.throws(() => requireNoReportedExternalProver({ proverServerUri }));
  }
});
