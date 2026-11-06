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
const DISCOVERY_LIMIT = 3600;
const DISCOVERY_INTERVAL_MS = 500;
const targetFilter = [{ type: 'background_page' }, { type: 'worker' }, { type: 'page' },
  { type: 'other' }, { type: 'service_worker' }, { exclude: true }];
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
  const classified = new Map();
  const discovery = { snapshots: 0, refreshLimit: DISCOVERY_LIMIT, classifiedTargets: {
    offscreenExact: 0, offscreenOtherType: 0, workerExact: 0, workerOtherType: 0,
    workerUrlEmpty: 0, extensionBlobWorker: 0, extensionOther: 0, other: 0,
  } };
  const started = Date.now();
  let discoveryTimer;
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
    if (closed || pending.size >= 32 || !sessions.has(sessionId)) return Promise.reject(fixedError());
    const id = ++nextId, key = `${sessionId}:${id}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(key); reject(fixedError()); }, 10_000);
      pending.set(key, { resolve, reject, timer });
      const parentSessionId = sessions.get(sessionId).parentSessionId;
      const payload = { sessionId, message: JSON.stringify({ id, method, params }) };
      const delivery = parentSessionId
        ? child(parentSessionId, 'Target.sendMessageToTarget', payload)
        : send('Target.sendMessageToTarget', payload);
      delivery
        .catch(() => { const item = pending.get(key); if (item) { clearTimeout(timer); pending.delete(key); reject(fixedError()); } });
    });
  }
  function receive({ sessionId, message }) {
    const session = sessions.get(sessionId);
    if (closed || !session || typeof message !== 'string') return;
    // No parsing/retention of requestWillBeSent, headers, frames or other events.
    const nested = message.startsWith('{"method":"Target.receivedMessageFromTarget"');
    if (nested) {
      // Inspect only the escaped *prefix* of the child's message. Request
      // events (and their potential bodies) are discarded before parsing the
      // outer envelope, just as on a direct observer session.
      if (session.kind !== 'offscreen' || session.parentSessionId !== null
          || !/^\{"method":"Target\.receivedMessageFromTarget","params":\{"sessionId":"[A-Za-z0-9-]{1,128}","message":"\{\\"(?:id\\":\d+[,}]|method\\":\\"Network\.(?:responseReceived|loadingFinished|loadingFailed)\\")/.test(message)) return;
    } else if (!/^\{"(?:id":\d+[,}]|method":"(?:Network\.(?:responseReceived|loadingFinished|loadingFailed)|Target\.attachedToTarget)")/.test(message)) return;
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
    const value = data.params;
    if (data.method === 'Target.receivedMessageFromTarget') {
      if (sessions.get(value?.sessionId)?.parentSessionId === sessionId) receive(value);
      return;
    }
    // Drain outstanding direct/nested command replies while shutting down,
    // without starting additional resource reads from late network events.
    if (closing) return;
    if (data.method === 'Target.attachedToTarget') {
      if (session.kind !== 'offscreen' || session.parentSessionId !== null) { fail('observer-unexpected-child-target'); return; }
      track(considerChild(sessionId, value)); return;
    }
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
    await enableSession(sessionId, kind, null);
  }
  async function enableSession(sessionId, kind, parentSessionId) {
    sessions.set(sessionId, { kind, parentSessionId, requests: new Set() }); targetCounts[kind]++;
    await child(sessionId, 'Network.enable', { maxPostDataSize: 0, maxResourceBufferSize: 4 * 1024 * 1024,
      maxTotalBufferSize: 8 * 1024 * 1024, enableDurableMessages: false, reportDirectSocketTraffic: false });
    if (kind === 'offscreen') {
      // This setting belongs only to our session on the exact signed offscreen
      // page. It neither replaces Playwright's browser policy nor pauses a
      // worker. Lace's signed page creates the single known proof-worker URL.
      await child(sessionId, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false,
        flatten: false, filter: [{ type: 'worker' }, { exclude: true }] });
    }
  }
  async function considerChild(parentSessionId, value) {
    const info = value?.targetInfo, sessionId = value?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length > 128) { fail('observer-unexpected-child-target'); return; }
    classify(info);
    const valid = value.waitingForDebugger === false && laceProverTargetKind(info) === 'worker'
      && typeof info.targetId === 'string' && info.targetId.length <= 128;
    if (closed || closing || !valid || targets.has(info.targetId) || targets.size >= 8) {
      await child(parentSessionId, 'Target.detachFromTarget', { sessionId }).catch(() => {});
      if (!valid || targets.size >= 8) fail('observer-unexpected-child-target');
      return;
    }
    targets.add(info.targetId);
    await enableSession(sessionId, 'worker', parentSessionId);
  }
  function classify(info) {
    if (closed || closing || !info || typeof info.targetId !== 'string' || info.targetId.length > 128) return;
    let categories = classified.get(info.targetId);
    if (!categories) {
      if (classified.size >= 256) { fail('observer-discovery-target-bound'); return; }
      categories = new Set(); classified.set(info.targetId, categories);
    }
    const url = typeof info.url === 'string' ? info.url : '';
    const category = url === `${origin}/offscreen.html` ? (info.type === 'background_page' ? 'offscreenExact' : 'offscreenOtherType')
      : url === `${origin}/js/4352.js` ? (info.type === 'worker' ? 'workerExact' : 'workerOtherType')
        : info.type === 'worker' && !url ? 'workerUrlEmpty'
          : info.type === 'worker' && url.startsWith(`blob:${origin}/`) ? 'extensionBlobWorker'
            : url.startsWith(`${origin}/`) ? 'extensionOther' : 'other';
    if (!categories.has(category)) { categories.add(category); discovery.classifiedTargets[category]++; }
  }
  const onTarget = ({ targetInfo }) => { classify(targetInfo); track(consider(targetInfo)); };
  async function refreshTargets() {
    if (closed || closing) return;
    if (discovery.snapshots >= DISCOVERY_LIMIT || Date.now() - started >= 30 * 60_000) {
      fail('observer-discovery-window-ended'); return;
    }
    discovery.snapshots++;
    const { targetInfos } = await send('Target.getTargets', { filter: targetFilter });
    if (!Array.isArray(targetInfos) || targetInfos.length > 256) throw fixedError();
    for (const info of targetInfos) classify(info);
    await Promise.all(targetInfos.map(consider));
  }
  function scheduleRefresh() {
    if (closed || closing || failureCategory) return;
    discoveryTimer = setTimeout(() => {
      // Chromium creates dedicated-worker targets with an empty URL and later
      // assigns the URL without a navigation notification. Re-read public
      // metadata; never attach to an unidentified/blank target to close the gap.
      const task = refreshTargets(); track(task);
      void task.then(scheduleRefresh, () => {});
    }, DISCOVERY_INTERVAL_MS);
    discoveryTimer.unref?.();
  }
  root.on('Target.receivedMessageFromTarget', receive);
  root.on('Target.targetCreated', onTarget);
  root.on('Target.targetInfoChanged', onTarget);
  async function close() {
    if (closed || closing) return;
    closing = true;
    clearTimeout(discoveryTimer);
    // Stop discovery before detaching only the sessions created by this observer.
    root.off('Target.targetCreated', onTarget); root.off('Target.targetInfoChanged', onTarget);
    await Promise.allSettled([...work]);
    // Disable only our offscreen auto-attacher after child Network sessions
    // have drained. Children must detach through their owning parent session.
    await Promise.allSettled([...sessions.entries()].filter(([, s]) => s.parentSessionId).map(async ([sessionId, session]) => {
      await child(sessionId, 'Network.disable').catch(() => {});
      await child(session.parentSessionId, 'Target.detachFromTarget', { sessionId }).catch(() => {});
    }));
    await Promise.allSettled([...sessions.entries()].filter(([, s]) => !s.parentSessionId).map(async ([sessionId, session]) => {
      if (session.kind === 'offscreen') await child(sessionId, 'Target.setAutoAttach', {
        autoAttach: false, waitForDebuggerOnStart: false, flatten: false,
      }).catch(() => {});
      await child(sessionId, 'Network.disable').catch(() => {});
      await send('Target.detachFromTarget', { sessionId }).catch(() => {});
    }));
    closed = true;
    root.off('Target.receivedMessageFromTarget', receive);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(fixedError()); }
    pending.clear(); sessions.clear(); classified.clear();
    await root.detach().catch(() => {});
  }
  try {
    await send('Target.setDiscoverTargets', { discover: true, filter: targetFilter });
    await refreshTargets();
    scheduleRefresh();
  } catch { await close(); throw fixedError(); }
  return Object.freeze({
    snapshot: () => ({ observed: observation !== null, status: failureCategory ? 'failed' : observation ? 'observed' : closed ? 'closed' : 'armed',
      failureCategory, targetCounts: { ...targetCounts }, ...(observation ?? {}),
      discovery: { ...discovery, classifiedTargets: { ...discovery.classifiedTargets } },
      requestPayloadsInspected: false, unrelatedEventsRetained: false, completeNetworkCoverage: false,
      runtimeEvaluationUsed: false, executionPaused: false }),
    close,
  });
}
