import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { laceProverTargetKind, verifyLaceProverResource, observeLaceProverWasm } from '../../scripts/lace-prover-observer.mjs';

const origin = 'chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk';
test('passive observation selects only the signed offscreen document and worker', () => {
  assert.equal(laceProverTargetKind({ type: 'background_page', url: origin + '/offscreen.html' }), 'offscreen');
  assert.equal(laceProverTargetKind({ type: 'worker', url: origin + '/js/4352.js' }), 'worker');
  for (const value of [null, {}, { type: 'page', url: origin + '/offscreen.html' },
    { type: 'service_worker', url: origin + '/js/sw/sw-script.js' },
    { type: 'worker', url: origin + '/js/4352.js?secret=withheld' },
    { type: 'worker', url: 'https://example.invalid/js/4352.js' },
    { type: 'background_page', url: origin + '/expo/index.html' }]) assert.equal(laceProverTargetKind(value), null);
});
test('resource gate rejects wrong encodings, lengths and same-size substituted bytes', () => {
  for (const value of [{}, { base64Encoded: false, body: 'withheld' },
    { base64Encoded: true, body: 'AA==' },
    { base64Encoded: true, body: Buffer.alloc(3_413_037).toString('base64') }]) {
    assert.throws(() => verifyLaceProverResource(value), error => error.message === 'Passive Lace prover observation did not complete');
  }
});
test('unsupported CDP rejects with fixed text without leaking transport details', async () => {
  await assert.rejects(observeLaceProverWasm({ newBrowserCDPSession: async () => { throw new Error('private transport detail'); } }),
    error => error.message === 'Passive Lace prover observation did not complete');
});

// Transport-boundary fixtures only: no wallet, proof, WASM response or observed
// success is fabricated. They model documented CDP metadata/message ordering.
function transport({ lateWorker = false, childWorker = false, bodyResult, bodyError } = {}) {
  const root = new EventEmitter(), calls = [];
  let snapshots = 0;
  const directReply = (sessionId, data) => queueMicrotask(() => root.emit('Target.receivedMessageFromTarget', {
    sessionId, message: JSON.stringify(data),
  }));
  const childReply = data => directReply('offscreen-session', {
    method: 'Target.receivedMessageFromTarget', params: { sessionId: 'worker-session', message: JSON.stringify(data) },
  });
  root.send = async (method, params) => {
    calls.push({ method, params });
    if (method === 'Target.getTargets') {
      snapshots++;
      return { targetInfos: lateWorker ? [{ targetId: 'synthetic-worker', type: 'worker',
        url: snapshots === 1 ? '' : origin + '/js/4352.js' }]
        : [{ targetId: 'synthetic-offscreen', type: 'background_page', url: origin + '/offscreen.html' }] };
    }
    if (method === 'Target.attachToTarget') return { sessionId: lateWorker ? 'worker-session' : 'offscreen-session' };
    if (method === 'Target.sendMessageToTarget') {
      const message = JSON.parse(params.message);
      calls.push({ method: message.method, params: message.params, sessionId: params.sessionId });
      if (message.method === 'Target.sendMessageToTarget') {
        const nested = JSON.parse(message.params.message);
        calls.push({ method: nested.method, params: nested.params, sessionId: message.params.sessionId });
        childReply(nested.method === 'Network.getResponseBody'
          ? bodyError ? { id: nested.id, error: bodyError } : { id: nested.id, result: bodyResult }
          : { id: nested.id, result: {} });
      }
      directReply(params.sessionId, { id: message.id, result: {} });
      if (childWorker && message.method === 'Target.setAutoAttach' && message.params.autoAttach) {
        directReply(params.sessionId, { method: 'Target.attachedToTarget', params: {
          sessionId: 'worker-session', waitingForDebugger: false,
          targetInfo: { targetId: 'synthetic-worker', type: 'worker', url: origin + '/js/4352.js' },
        } });
      }
    }
    return {};
  };
  root.detach = async () => {};
  return { root, calls, childReply, browser: { newBrowserCDPSession: async () => root } };
}

test('bounded refresh reconsiders a worker whose URL was initially empty', async () => {
  const fixture = transport({ lateWorker: true });
  const observer = await observeLaceProverWasm(fixture.browser);
  try {
    assert.equal(observer.snapshot().targetCounts.worker, 0);
    await delay(650);
    const result = observer.snapshot();
    assert.equal(result.targetCounts.worker, 1);
    assert.equal(result.discovery.classifiedTargets.workerUrlEmpty, 1);
    assert.equal(result.discovery.classifiedTargets.workerExact, 1);
    assert.equal(result.observed, false);
    assert.equal(result.failureCategory, null);
    assert.ok(!JSON.stringify(result).includes('synthetic-worker'), 'Target IDs must not be exported');
  } finally { await observer.close(); }
});

test('only the exact offscreen session auto-attaches its worker without pausing', async () => {
  const fixture = transport({ childWorker: true });
  const observer = await observeLaceProverWasm(fixture.browser);
  try {
    await delay(10);
    const result = observer.snapshot();
    assert.equal(result.targetCounts.offscreen, 1);
    assert.equal(result.targetCounts.worker, 1);
    const auto = fixture.calls.filter(call => call.method === 'Target.setAutoAttach');
    assert.ok(auto.length === 1 && auto[0].sessionId === 'offscreen-session'
      && auto[0].params.waitForDebuggerOnStart === false && auto[0].params.flatten === false,
    'Auto-attachment must remain on our exact offscreen session without pausing');
    const buffers = fixture.calls.filter(call => call.method === 'Network.enable');
    const encodedLength = Math.ceil(3_413_037 / 3) * 4;
    assert.ok(buffers.length === 2 && buffers.every(call => call.params.maxResourceBufferSize >= encodedLength * 2
      && call.params.maxTotalBufferSize === call.params.maxResourceBufferSize * 2
      && call.params.maxTotalBufferSize <= 24 * 1024 * 1024),
    'Bounded inspector buffers must fit the base64 content even as a two-byte string');
    fixture.root.emit('Target.receivedMessageFromTarget', { sessionId: 'offscreen-session', message: JSON.stringify({
      method: 'Target.receivedMessageFromTarget', params: { sessionId: 'worker-session',
        message: '{"method":"Network.requestWillBeSent","params": deliberately-unparsed-private-body' },
    }) });
    assert.equal(observer.snapshot().failureCategory, null);
    assert.equal(observer.snapshot().observed, false);
    assert.ok(!fixture.calls.some(call => call.method === 'Network.getResponseBody'), 'Unrelated requests must not trigger body reads');
  } finally { await observer.close(); }
  assert.equal(observer.snapshot().status, 'closed');
});

test('exact public resource failures distinguish CDP retrieval, encoding, length and hash without raw details', async () => {
  const cases = [
    { bodyError: { code: -32000, message: 'Request content was evicted from inspector cache' }, expected: 'prover-resource-body-evicted' },
    { bodyError: { code: -32000, message: 'sensitive-boundary-value' }, expected: 'prover-resource-body-command-rejected' },
    { bodyResult: { base64Encoded: false, body: 'sensitive-boundary-value' }, expected: 'prover-resource-encoding-invalid' },
    { bodyResult: { base64Encoded: true, body: 'AA==' }, expected: 'prover-resource-encoded-length-mismatch' },
    // This exercises the real nested-message parser with a >4 MiB body and
    // the real SHA check. Substituted bytes must never become an observation.
    { bodyResult: { base64Encoded: true, body: Buffer.alloc(3_413_037).toString('base64') }, expected: 'prover-resource-hash-mismatch' },
  ];
  for (const value of cases) {
    const fixture = transport({ childWorker: true, ...value });
    const observer = await observeLaceProverWasm(fixture.browser);
    try {
      await delay(5);
      fixture.childReply({ method: 'Network.responseReceived', params: { requestId: 'synthetic-public-resource',
        response: { url: origin + '/js/bb7c1f073eb0bc071ea5.module.wasm', status: 200 } } });
      fixture.childReply({ method: 'Network.loadingFinished', params: { requestId: 'synthetic-public-resource' } });
      await delay(10);
      const result = observer.snapshot();
      assert.equal(result.failureCategory, value.expected);
      assert.equal(result.observed, false);
      assert.equal(result.status, 'failed');
      assert.ok(!JSON.stringify(result).includes('sensitive-boundary-value'), 'Raw diagnostic data must not be exported');
    } finally { await observer.close(); }
  }
});
