import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise only the actual CI URL policy; no browser, wallet, proof or network.
const source = await readFile(new URL('../../scripts/test-lace-preview-browser.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first); return source.slice(first, last);
}
const context = vm.createContext({ URL, origin: 'http://127.0.0.1:12345',
  EXTENSION_ID: 'gafhhkghbfjjkeiendhlofajokpaflmk', walletVendorServiceUrls: new Set() });
vm.runInContext(section('const walletPublicAssetPaths =', 'async function startServer(')
  + section('function allowedNetworkUrl(', 'function countBlockedRequest(')
  + '\nthis.allowed = allowedNetworkUrl;', context);

test('Preview wallet assets allow only the signed generation-10 circuit paths and bounded SRS', () => {
  for (const circuit of ['zswap/spend', 'zswap/output', 'zswap/sign', 'dust/spend']) {
    const [group, name] = circuit.split('/');
    for (const type of ['prover', 'verifier', 'bzkir']) {
      const url = `https://srs.midnight.network/${group}/10/${name}.${type}`;
      for (const method of ['GET', 'HEAD']) assert.equal(context.allowed(url, method), true);
      for (const method of ['POST', 'PUT', 'OPTIONS']) assert.equal(context.allowed(url, method), false);
      for (const generation of ['9', '11']) assert.equal(context.allowed(url.replace('/10/', `/${generation}/`)), false);
    }
  }
  for (let k = 0; k <= 25; k++) assert.equal(context.allowed(`https://srs.midnight.network/bls_midnight_2p${k}`), true);
  for (const suffix of ['26', '-1', '01', '1?token=x', '1/extra'])
    assert.equal(context.allowed(`https://srs.midnight.network/bls_midnight_2p${suffix}`), false);
});

test('wallet asset policy refuses foreign origins, credentials, alternate ports and proving POSTs', () => {
  for (const url of [
    'http://srs.midnight.network/dust/10/spend.prover',
    'https://srs.midnight.network:444/dust/10/spend.prover',
    'https://user:pass@srs.midnight.network/dust/10/spend.prover',
    'https://srs.midnight.network/dust/10/spend.prover?x=1',
    'https://srs.midnight.network/dust/10/spend.prover#x',
    'https://unrelated.example/dust/10/spend.prover',
    'http://localhost:6300/prove', 'http://127.0.0.1:6300/prove',
  ]) assert.equal(context.allowed(url), false);
});
