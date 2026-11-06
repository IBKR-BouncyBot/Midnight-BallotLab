// Transport/configuration boundary checks only. Stub responses below do not
// exercise cryptography, a real service, wallet, proof or accepted transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_PUBLIC_SERVICES, previewBrowserConfiguration, checkPreviewPublicServices, formatPreviewServiceError } from '../contracts/native/public-testnet.mjs';
import { resolveNativeBrowserConfig, requireNoReportedExternalProver, requireConnectedNetwork } from '../contracts/native/browser-config.mjs';

const rpc = { jsonrpc: '2.0', id: 1, result: 'Midnight Preview' };
const block = { data: { block: { height: 1234 } } };
const response = data => ({ ok: true, json: async () => data });
function transport({ node = rpc, indexer = block } = {}) {
  return async url => response(url === PREVIEW_PUBLIC_SERVICES.nodeRpc ? node : indexer);
}

test('Preview settings are immutable and callers cannot override their network or services', () => {
  const config = previewBrowserConfiguration({ networkId: 'mainnet', indexerUri: 'https://example.invalid', compiledAssetsUrl: './keys' });
  assert.ok(Object.isFrozen(PREVIEW_PUBLIC_SERVICES)); assert.ok(Object.isFrozen(config));
  assert.equal(config.networkId, 'preview'); assert.equal(config.indexerUri, PREVIEW_PUBLIC_SERVICES.indexerUri);
  assert.equal(config.compiledAssetsUrl, './keys');
  assert.throws(() => { PREVIEW_PUBLIC_SERVICES.networkId = 'mainnet'; }, TypeError);
  assert.throws(() => { config.indexerUri = 'https://example.invalid'; }, TypeError);
  assert.equal(previewBrowserConfiguration().compiledAssetsUrl, './native-contract');
  assert.throws(() => previewBrowserConfiguration({ compiledAssetsUrl: '' }));
});

test('Preview check sends only fixed public queries and reports no wallet/proof/transaction execution', async () => {
  const calls = [];
  const result = await checkPreviewPublicServices({ fetchImpl: async (url, options) => {
    calls.push({ url, options }); return transport()(url);
  } });
  assert.deepEqual(calls.map(call => call.url).sort(), [PREVIEW_PUBLIC_SERVICES.nodeRpc, PREVIEW_PUBLIC_SERVICES.indexerUri].sort());
  assert.deepEqual(JSON.parse(calls.find(call => call.url === PREVIEW_PUBLIC_SERVICES.nodeRpc).options.body),
    { jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] });
  assert.deepEqual(JSON.parse(calls.find(call => call.url === PREVIEW_PUBLIC_SERVICES.indexerUri).options.body), { query: '{ block { height } }' });
  for (const { options } of calls) {
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error'); assert.equal(options.referrerPolicy, 'no-referrer');
  }
  assert.deepEqual(result, { networkId: 'preview', chainName: 'Midnight Preview', blockHeight: 1234,
    source: 'fixed-public-preview-services', walletConnected: false, proofGenerated: false, transactionSubmitted: false });
  assert.ok(Object.isFrozen(result));
});

test('Preview check rejects other chains and malformed RPC identity responses', async () => {
  for (const node of [null, {}, { ...rpc, result: 'Midnight Mainnet' }, { ...rpc, result: 'Midnight Preprod' },
    { ...rpc, result: 'midnight preview' }, { ...rpc, id: 9 }, { ...rpc, error: { message: 'untrusted response' } }]) {
    await assert.rejects(checkPreviewPublicServices({ fetchImpl: transport({ node }) }), error => error.code === 'network-identity');
  }
});

test('Preview check rejects malformed indexer responses and GraphQL errors', async () => {
  for (const indexer of [null, {}, { data: { block: null } }, ...[-1, 1.2, '1234', Number.MAX_SAFE_INTEGER + 1].map(height => ({ data: { block: { height } } })),
    { ...block, errors: [{ message: 'untrusted details' }] }, { ...block, errors: 'invalid' }]) {
    await assert.rejects(checkPreviewPublicServices({ fetchImpl: transport({ indexer }) }), error => error.code === 'indexer-response');
  }
});

test('Preview diagnostics identify each failed service without exposing upstream error data', async () => {
  const marker = 'SYNTHETIC-PRIVATE-ERROR-CONTENT';
  for (const service of ['node', 'indexer']) {
    const endpoint = service === 'node' ? PREVIEW_PUBLIC_SERVICES.nodeRpc : PREVIEW_PUBLIC_SERVICES.indexerUri;
    for (const [code, failedFetch] of [
      ['transport-unavailable', async () => { throw new Error(marker); }],
      ['http-status', async () => ({ ok: false, status: 503, statusText: marker })],
      ['invalid-json', async () => ({ ok: true, json: async () => { throw new Error(marker); } })],
    ]) {
      await assert.rejects(checkPreviewPublicServices({ fetchImpl: url => url === endpoint ? failedFetch() : transport()(url) }), error => {
        assert.equal(error.code, code); assert.equal(error.service, service); assert.equal(error.cause, undefined);
        const message = formatPreviewServiceError(error);
        assert.ok(typeof message === 'string' && message.includes(`Preview ${service}`), 'A failed service must be identified');
        assert.ok(!message.includes(marker) && !error.message.includes(marker), 'Upstream error data must remain private');
        assert.ok(message.includes('did not connect a wallet or submit a transaction'), 'Read-only check scope must remain explicit');
        return true;
      });
    }
  }
});

test('Preview HTTP diagnostics accept only numeric HTTP statuses and explain rate limits', async () => {
  for (const status of [429, 503, 999, 'SYNTHETIC-PRIVATE-STATUS']) {
    await assert.rejects(checkPreviewPublicServices({ fetchImpl: async url => url === PREVIEW_PUBLIC_SERVICES.nodeRpc
      ? { ok: false, status } : response(block) }), error => {
      assert.equal(error.code, 'http-status'); assert.equal(error.service, 'node');
      const valid = status === 429 || status === 503;
      assert.equal(error.httpStatus, valid ? status : undefined);
      const text = formatPreviewServiceError(error);
      assert.ok(valid ? text.includes(`HTTP ${status}`) : text.includes('unusable HTTP response'), 'HTTP diagnostic must use only validated status');
      if (status === 429) assert.ok(text.includes('wait before trying again'), 'Rate limit diagnostic should explain retry timing');
      assert.ok(!text.includes('SYNTHETIC'), 'Untrusted status must remain private');
      return true;
    });
  }
});

test('Preview formatter rejects forged errors and ignores mutation of a genuine error message', async () => {
  let actual;
  try { await checkPreviewPublicServices({ fetchImpl: async () => { throw new Error('SYNTHETIC-TRANSPORT'); } }); }
  catch (error) { actual = error; }
  const original = formatPreviewServiceError(actual);
  assert.ok(typeof original === 'string', 'A genuine error must have a safe diagnostic');
  actual.message = 'SYNTHETIC-PRIVATE-MUTATION';
  assert.ok(formatPreviewServiceError(actual) === original, 'A mutated error message must not replace its safe diagnostic');
  const hostile = new Proxy({}, { get() { throw new Error('Arbitrary getters must not be read'); } });
  for (const error of [undefined, null, 'SYNTHETIC', 1, Symbol('SYNTHETIC'), new Error('SYNTHETIC'),
    { name: 'PreviewServiceCheckError', code: actual.code, service: 'node', message: original },
    Object.create(Object.getPrototypeOf(actual)), { ...actual }, hostile]) {
    assert.ok(formatPreviewServiceError(error) === null, 'Only locally branded errors may supply diagnostics');
  }
});

test('Preview service check has a real 15-second bound even when a transport ignores cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requestSignal;
  const result = checkPreviewPublicServices({ fetchImpl: (_url, options) => {
    requestSignal = options.signal; return new Promise(() => {});
  } });
  const rejected = assert.rejects(result, error => error.code === 'timeout' && error.service === 'services'
    && formatPreviewServiceError(error).includes('15 seconds'));
  t.mock.timers.tick(15_000);
  await rejected; assert.equal(requestSignal.aborted, true);
});

test('Preview timeout identifies the indexer when the node has already passed validation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = checkPreviewPublicServices({ fetchImpl: url => url === PREVIEW_PUBLIC_SERVICES.nodeRpc
    ? Promise.resolve(response(rpc)) : new Promise(() => {}) });
  const rejected = assert.rejects(result, error => error.code === 'timeout' && error.service === 'indexer'
    && formatPreviewServiceError(error).includes('Preview indexer'));
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(15_000); await rejected;
});

test('Preview cancellation identifies the node when only its response remains pending', async () => {
  const controller = new AbortController();
  const result = checkPreviewPublicServices({ signal: controller.signal, fetchImpl: url => url === PREVIEW_PUBLIC_SERVICES.indexerUri
    ? Promise.resolve(response(block)) : new Promise(() => {}) });
  const rejected = assert.rejects(result, error => error.code === 'cancelled' && error.service === 'node'
    && !formatPreviewServiceError(error).includes('SYNTHETIC'));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error('SYNTHETIC-PRIVATE-REASON')); await rejected;
});

test('Preview checks accept caller cancellation without exposing the cancellation reason', async () => {
  const controller = new AbortController(); let calls = 0;
  controller.abort(new Error('SYNTHETIC-PRIVATE-CANCELLATION'));
  await assert.rejects(checkPreviewPublicServices({ signal: controller.signal, fetchImpl: async () => { calls++; } }),
    error => error.code === 'cancelled' && !error.message.includes('SYNTHETIC'));
  assert.equal(calls, 0);
});

test('known public service hosts cannot silently cross networks, including mainnet', () => {
  const base = previewBrowserConfiguration();
  for (const indexerUri of ['https://indexer.mainnet.midnight.network/api/v4/graphql',
    'https://midnight-mainnet.blockfrost.io/api/v0?project_id=SYNTHETIC',
    'https://indexer.preprod.midnight.network/api/v4/graphql', 'https://midnight-preprod.blockfrost.io./api/v0']) {
    assert.throws(() => resolveNativeBrowserConfig({ ...base, indexerUri }, 'https://example.test/project/network.html'),
      error => /different network/.test(error.message) && !error.message.includes('SYNTHETIC'));
  }
  assert.throws(() => resolveNativeBrowserConfig({ ...base, indexerWsUri: 'wss://midnight-mainnet.blockfrost.io/api/v0/ws' }, 'https://example.test/'));
  assert.throws(() => resolveNativeBrowserConfig({ ...base, networkId: 'preprod' }, 'https://example.test/'));
  assert.throws(() => resolveNativeBrowserConfig({ ...base, networkId: 'mainnet' }, 'https://example.test/'));
});

test('custom secure indexers and same-network query auth remain possible without relaxing prover or asset guards', () => {
  const result = resolveNativeBrowserConfig({ ...previewBrowserConfiguration(), networkId: 'preprod',
    indexerUri: 'https://midnight-preprod.blockfrost.io/api/v0?project_id=SYNTHETIC',
    indexerWsUri: 'wss://midnight-preprod.blockfrost.io/api/v0/ws?project_id=SYNTHETIC' }, 'https://example.test/project/network.html');
  assert.equal(new URL(result.indexerUri).searchParams.get('project_id'), 'SYNTHETIC');
  assert.equal(result.compiledAssetsUrl, 'https://example.test/project/native-contract');
  assert.doesNotThrow(() => resolveNativeBrowserConfig({ ...previewBrowserConfiguration(), indexerUri: 'https://custom.example.test/graphql',
    indexerWsUri: 'wss://custom.example.test/ws' }, 'https://example.test/'));
  assert.throws(() => requireNoReportedExternalProver({ proverServerUri: 'https://remote.example.test' }));
  assert.throws(() => resolveNativeBrowserConfig(previewBrowserConfiguration({ compiledAssetsUrl: 'https://remote.example.test/keys' }), 'https://example.test/'));
});

test('wallet-reported known services must match its declared selected network before submission', () => {
  const status = { status: 'connected', networkId: 'preview' };
  for (const field of ['indexerUri', 'indexerWsUri', 'substrateNodeUri']) {
    assert.throws(() => requireConnectedNetwork(status, { networkId: 'preview',
      [field]: 'https://rpc.midnight-mainnet.blockfrost.io?project_id=SYNTHETIC' }, 'preview'),
      error => /different network/.test(error.message) && !error.message.includes('SYNTHETIC'));
    assert.throws(() => requireConnectedNetwork(status, { networkId: 'preview', [field]: 'SYNTHETIC-INVALID-URL' }, 'preview'),
      error => !error.message.includes('SYNTHETIC'));
  }
  assert.doesNotThrow(() => requireConnectedNetwork(status, { networkId: 'preview', substrateNodeUri: PREVIEW_PUBLIC_SERVICES.nodeRpc,
    indexerUri: PREVIEW_PUBLIC_SERVICES.indexerUri, indexerWsUri: PREVIEW_PUBLIC_SERVICES.indexerWsUri }, 'preview'));
  assert.doesNotThrow(() => requireConnectedNetwork(status, { networkId: 'preview', substrateNodeUri: 'wss://custom.example.test/node' }, 'preview'));
});
