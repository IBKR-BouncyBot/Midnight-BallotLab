/** CI-only passive observation. No Runtime, storage, interception or pauses.
 * Network events may transit the CDP session; unrelated messages are discarded
 * before parsing and are never logged or retained. This is not an egress gate.
 */
import { createHash } from 'node:crypto';

const origin = 'chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk';
export const LACE_PROVER_RESOURCE = Object.freeze({
  path: 'js/bb7c1f073eb0bc071ea5.module.wasm', bytes: 3_413_037,
  sha256: 'f5326f9e869d7795edbe4a80ad1ed7f0e8636178f60c0268ecd4700787612cdb',
});
const resourceUrl = `${origin}/${LACE_PROVER_RESOURCE.path}`;
const fixedError = () => new Error('Passive Lace prover observation did not complete');
export function laceProverTargetKind(value) {
  if (value?.type === 'background_page' && value.url === `${origin}/offscreen.html`) return 'offscreen';
  if (value?.type === 'worker' && value.url === `${origin}/js/4352.js`) return 'worker';
  return null;
}
export function verifyLaceProverResource(value) {
  const length = Math.ceil(LACE_PROVER_RESOURCE.bytes / 3) * 4;
  if (value?.base64Encoded !== true || typeof value.body !== 'string' || value.body.length !== length
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.body)) throw fixedError();
  const bytes = Buffer.from(value.body, 'base64');
  try {
    if (bytes.length !== LACE_PROVER_RESOURCE.bytes || bytes.toString('base64') !== value.body
        || createHash('sha256').update(bytes).digest('hex') !== LACE_PROVER_RESOURCE.sha256) throw fixedError();
    return { ...LACE_PROVER_RESOURCE };
  } finally { bytes.fill(0); }
}

export async function observeLaceProverWasm(browser) {
  let root;
  try { root = await browser.newBrowserCDPSession(); } catch { throw fixedError(); }
  let closed = false, closing = false, nextId = 0, failureCategory = null, observation = null;
  const targets = new Set(), sessions = new Map(), pending = new Map(), work = new Set();
  const targetCounts = { offscreen: 0, worker: 0 };
  const fail = category => { failureCategory ??= category; };
  const track = promise => {
    work.add(promise);
    promise.catch(() => { if (!closed) fail('observer-command-failed'); }).finally(() => work.delete(promise));
  };
  async function send(method, params) {
    let timer;
    try {
      return await Promise.race([root.send(method, params), new Promise((_, reject) => {
        timer = setTimeout(() => reject(fixedError()), 10_000);
      })]);
    } catch { throw fixedError(); } finally { clearTimeout(timer); }
  }
  function child(sessionId, method, params = {}) {
    if (closed || pending.size >= 16) return Promise.reject(fixedError());
    const id = ++nextId, key = `${sessionId}:${id}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(key); reject(fixedError()); }, 10_000);
      pending.set(key, { resolve, reject, timer });
      send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        .catch(() => { const item = pending.get(key); if (item) { clearTimeout(timer); pending.delete(key); reject(fixedError()); } });
    });
  }
  function receive({ sessionId, message }) {
    const session = sessions.get(sessionId);
    if (closed || !session || typeof message !== 'string') return;
    // No parsing/retention of requestWillBeSent, headers, frames or other events.
    if (!/^\{"(?:id":\d+[,}]|method":"Network\.(?:responseReceived|loadingFinished|loadingFailed)")/.test(message)) return;
    if (message.length > 6 * 1024 * 1024) { fail('observer-message-bound'); return; }
    let data;
    try { data = JSON.parse(message); } catch { fail('observer-message-invalid'); return; }
    if (Number.isSafeInteger(data.id)) {
      const key = `${sessionId}:${data.id}`, item = pending.get(key);
      if (!item) return;
      pending.delete(key); clearTimeout(item.timer);
      if (data.error) item.reject(fixedError()); else item.resolve(data.result);
      return;
    }
    // Drain outstanding command replies while shutting down, without starting
    // additional resource reads from late network events.
    if (closing) return;
    const value = data.params;
    if (data.method === 'Network.responseReceived') {
      if (value?.response?.url !== resourceUrl) return;
      if (value.response.status !== 200 || typeof value.requestId !== 'string' || value.requestId.length > 256) {
        fail('prover-resource-response-invalid'); return;
      }
      if (session.requests.size >= 4) { fail('prover-resource-request-bound'); return; }
      session.requests.add(value.requestId);
    } else if (session.requests.has(value?.requestId)) {
      session.requests.delete(value.requestId);
      if (data.method === 'Network.loadingFailed') { fail('prover-resource-load-failed'); return; }
      track((async () => {
        let body;
        try {
          body = await child(sessionId, 'Network.getResponseBody', { requestId: value.requestId });
          const verified = verifyLaceProverResource(body);
          observation = { ...verified, targetKind: session.kind, evidence: 'passive-cdp-resource-response' };
        } catch { fail('prover-resource-body-unavailable-or-invalid'); }
        finally { body = undefined; }
      })());
    }
  }
  async function consider(info) {
    const kind = laceProverTargetKind(info);
    if (closed || closing || !kind || targets.has(info.targetId)) return;
    if (typeof info.targetId !== 'string' || info.targetId.length > 128 || targets.size >= 8) { fail('observer-target-bound'); return; }
    targets.add(info.targetId);
    const { sessionId } = await send('Target.attachToTarget', { targetId: info.targetId, flatten: false });
    if (typeof sessionId !== 'string' || sessionId.length > 128) throw fixedError();
    sessions.set(sessionId, { kind, requests: new Set() }); targetCounts[kind]++;
    await child(sessionId, 'Network.enable', { maxPostDataSize: 0, maxResourceBufferSize: 4 * 1024 * 1024,
      maxTotalBufferSize: 8 * 1024 * 1024, enableDurableMessages: false, reportDirectSocketTraffic: false });
  }
  const onTarget = ({ targetInfo }) => track(consider(targetInfo));
  root.on('Target.receivedMessageFromTarget', receive);
  root.on('Target.targetCreated', onTarget);
  root.on('Target.targetInfoChanged', onTarget);
  async function close() {
    if (closed || closing) return;
    closing = true;
    // Stop discovery before detaching only the sessions created by this observer.
    root.off('Target.targetCreated', onTarget); root.off('Target.targetInfoChanged', onTarget);
    await Promise.allSettled([...work]);
    await Promise.allSettled([...sessions.keys()].map(async sessionId => {
      await child(sessionId, 'Network.disable').catch(() => {});
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }));
    closed = true;
    root.off('Target.receivedMessageFromTarget', receive);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(fixedError()); }
    pending.clear(); sessions.clear();
    await root.detach().catch(() => {});
  }
  try {
    await send('Target.setDiscoverTargets', { discover: true, filter: [
      { type: 'background_page' }, { type: 'worker' }, { exclude: true },
    ] });
    const { targetInfos } = await send('Target.getTargets');
    if (!Array.isArray(targetInfos) || targetInfos.length > 256) throw fixedError();
    await Promise.all(targetInfos.map(consider));
  } catch { await close(); throw fixedError(); }
  return Object.freeze({
    snapshot: () => ({ observed: observation !== null, status: failureCategory ? 'failed' : observation ? 'observed' : closed ? 'closed' : 'armed',
      failureCategory, targetCounts: { ...targetCounts }, ...(observation ?? {}),
      requestPayloadsInspected: false, unrelatedEventsRetained: false, completeNetworkCoverage: false,
      runtimeEvaluationUsed: false, executionPaused: false }),
    close,
  });
}
