import test from 'node:test';
import assert from 'node:assert/strict';
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
