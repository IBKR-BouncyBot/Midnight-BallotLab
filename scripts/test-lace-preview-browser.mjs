/** CI ONLY: genuine disposable Lace + Preview, through the normal wallet/app UI.
 * No personal profile, wallet API substitute, HTTP prover, transaction retry,
 * private checkpoint, console dump, screenshot, trace or video is produced.
 * The same browser stays alive while a separately authorized sponsor funds its
 * public address. A failure is evidence of failure, never an acceptance flag.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeJsonUtf8, parseStrictJson } from '../src/json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireContracts = createRequire(join(root, 'contracts/package.json'));
const EXTENSION_ID = 'gafhhkghbfjjkeiendhlofajokpaflmk';
const LACE_VERSION = '2.5.1';
const LACE_API_VERSION = '4.1.0-canary.20260819082604-3b622cb';
const EXTENSION_ARCHIVE_SHA = 'aa6d59550362a3bbcbef343dffd783621150a7971307116bb11fe0d94b754708';
const EXTENSION_MANIFEST_SHA = '5e67d8265b510e9b5b1c0546677d5f3f6316aaa440591dcc0af3d7f4a8858391';
const WALLET_PROVER_WASM = 'js/bb7c1f073eb0bc071ea5.module.wasm';
const WALLET_PROVER_WASM_SHA = 'f5326f9e869d7795edbe4a80ad1ed7f0e8636178f60c0268ecd4700787612cdb';
const WALLET_PROVER_WASM_BYTES = 3_413_037;
const INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
const LACE_FLAGS_URL = 'https://e.lw.iog.io/flags/?v=2&config=true';
const LACE_PUBLIC_CLIENT_TOKEN_SHA = '426d05db61174615365a278ebe9acdfbfcbda9176186f5f2242b87051d0b2908';
const hash = value => createHash('sha256').update(value).digest('hex');
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const extensionOrigin = `chrome-extension://${EXTENSION_ID}`;
const started = Date.now(), overallDeadline = started + 180 * 60_000;
const report = {
  schema: 'midnight-ballot-lab/ci-lace-preview-browser/v1', status: 'preparing',
  startedAt: new Date(started).toISOString(), networkId: 'preview',
  execution: 'genuine-disposable-Lace-and-application-UI', operations: [],
  transactionsRetried: 0, independentChainVerification: false,
  fundingSource: 'separately-authorized-isolated-SDK-sponsor-not-browser-proof-evidence',
  privateArtifactsExported: false, hostedOriginTested: false,
  walletModeApiAttestation: false, httpProofProviderConfigured: false,
};
const journal = { schema: 'midnight-ballot-lab/ci-public-transaction-journal/v1', networkId: 'preview', operations: report.operations };
let output, browserContext, app, wallet, server, origin, profileRoot;
let stage = 'ci-prerequisites', currentOperation, canSave = false, shuttingDown = false;
let walletPassword, appPassword, publicIdentity;
const walletWasmObservations = [];
const walletVendorServiceUrls = new Set(), configurationResponses = [];
let configurationFailure = false;
const settingsControlIds = Object.freeze(['settings-tab-btn', 'option-list-item-network', 'radio-button-testnet',
  'radio-button-midnight-preview', 'network-selection-sheet-confirm-button', 'network-selection-sheet',
  'option-list-item-midnight', 'proof-server-in-process-radio', 'proof-server-local-host-radio', 'save-configuration-button',
  'midnight-settings-sheet-header', 'side-sheet-close-button', 'portfolio-tab-btn']);
const REQUEST_PATH_LABELS = Object.freeze(['wallet-public-flags', 'wallet-telemetry', 'wallet-config-other-path',
  'wallet-indexer-current', 'wallet-indexer-current-other-path', 'wallet-node-current', 'wallet-node-current-other-path',
  'wallet-indexer-retired', 'wallet-node-retired', 'public-proving-assets', 'loopback-prover', 'other']);
const traffic = { blockedRequests: 0, blockedWebSockets: 0, walletWasmResources: 0, appWasmResources: 0,
  publicConfigurationRequests: 0, publicConfigurationResponses: 0,
  pageErrors: 0, consoleErrors: 0, consoleWarnings: 0,
  blockedRequestCategories: { unknownHost: 0, unexpectedKnownPathOrMethod: 0, queryOrCredentials: 0, unexpectedPort: 0, invalidUrl: 0 },
  blockedKnownPaths: Object.fromEntries(REQUEST_PATH_LABELS.map(label => [label, 0])) };
const allowedPublicPhases = new Map([
  ['Preparing the transaction and any required proofs…', 'preparation-started'],
  ['Transaction preparation finished. The network has not accepted it yet.', 'preparation-completed'],
  ['Check your wallet to approve the transaction and its fee.', 'wallet-approval-requested'],
  ['Your wallet signed the transaction.', 'wallet-signed'],
  ['Transaction submitted. Waiting for confirmation from your indexer…', 'submission-returned'],
  ['Contract proof created in this browser. Wallet approval and network confirmation are still separate steps.', 'contract-proof-completed'],
  ['Transaction prepared. No contract-call proof was needed for this step.', 'no-contract-proof-required'],
  ['Loading and checking public proving files. The first proof needs a larger download; keep this tab open.', 'public-assets-loading'],
  ['Checking the contract inputs on this device…', 'contract-constraints-checking'],
  ['Creating the contract proof in this browser. This can take a few minutes; keep this tab open.', 'contract-proving'],
]);

const safeFailures = new WeakMap();
function fail(category) { const error = new Error('CI acceptance stopped'); safeFailures.set(error, category); throw error; }
function requireThat(condition, category) { if (!condition) fail(category); }
async function atomic(name, value) {
  const target = join(output, name), temporary = `${target}.pending`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, target);
}
let saving = Promise.resolve();
function save() {
  if (!canSave) return Promise.resolve();
  // Serialize writes, including progress callbacks, without capturing secrets.
  const persist = async () => {
    await atomic('public-journal.json', journal);
    await atomic('browser-report.json', { ...report, currentStage: stage, traffic });
  };
  saving = saving.then(persist, persist);
  return saving;
}
async function setStage(next) { stage = next; await save(); process.stdout.write(JSON.stringify({ stage: next }) + '\n'); }
async function settingsControlSnapshot() {
  if (!wallet || wallet.isClosed()) return [];
  const results = [];
  for (const id of settingsControlIds) {
    const locator = wallet.getByTestId(id), count = await locator.count().catch(() => 0);
    const entry = { control: id, count: Math.min(count, 99) };
    if (count === 1) {
      entry.visible = await locator.isVisible().catch(() => false);
      entry.enabled = await locator.isEnabled().catch(() => false);
      for (const name of ['aria-selected', 'aria-checked']) {
        const value = await locator.getAttribute(name, { timeout: 1000 }).catch(() => null);
        entry[name === 'aria-selected' ? 'selected' : 'checked'] = value === 'true' ? true : value === 'false' ? false : null;
      }
      const disabled = await locator.getAttribute('aria-disabled', { timeout: 1000 }).catch(() => undefined);
      entry.ariaDisabled = disabled === 'true' ? true : disabled === 'false' ? false : null;
    }
    results.push(entry);
  }
  return results;
}
async function settingsModeSnapshot(point) {
  requireThat(['before-save', 'before-keyboard-save', 'after-reopen', 'failure'].includes(point), 'invalid-settings-observation-point');
  const modes = [];
  for (const mode of ['in-process', 'local-host']) {
    const id = `proof-server-${mode}-radio`, control = wallet.getByTestId(id);
    const count = await control.count();
    const entry = { mode, present: count === 1 };
    if (count === 1) {
      entry.visible = await control.isVisible(); entry.enabled = await control.isEnabled();
      Object.assign(entry, await control.evaluate((element, expectedId) => ({
        markerPresent: element.querySelector(`[data-testid="${expectedId}-checkmark"]`) !== null,
        hovered: element.matches(':hover'), active: element.matches(':active'), focused: element.matches(':focus-within'),
        ariaDisabled: element.getAttribute('aria-disabled') === 'true' ? true
          : element.getAttribute('aria-disabled') === 'false' ? false : null,
      }), id));
    }
    modes.push(entry);
  }
  report.settingsModeObservations ??= [];
  report.settingsModeObservations.push({ point, modes });
  await save();
}
async function settingsClick(id, name, { visibleOnly = false } = {}) {
  requireThat(settingsControlIds.includes(id), 'unsupported-settings-diagnostic-control');
  await setStage(name);
  report.lastSettingsControl = id; await save();
  const control = wallet.getByTestId(id);
  await (visibleOnly ? control.filter({ visible: true }) : control).click();
}
async function clearWalletPointerAndFocus(focusControl) {
  await wallet.mouse.move(0, 0);
  await wallet.getByTestId(focusControl).focus();
}
async function onboardingToggleMatches(id, checked) {
  return wallet.getByTestId(id).evaluate((element, expected) => {
    // Signed Lace 2.5.1's RN Web filter drops accessibilityState. Its Toggle
    // instead exposes this ordinary rendered track/knob geometry (module2760).
    // Exclude hover/press/focus so the transient wider knob cannot look checked.
    if (element.matches(':hover, :active, :focus-within')) return false;
    const track = element.parentElement, knob = element.nextElementSibling;
    if (!track || !knob) return false;
    const trackWidth = track.getBoundingClientRect().width, style = getComputedStyle(knob);
    const width = Number.parseFloat(style.width), x = new DOMMatrixReadOnly(style.transform).m41;
    return Math.abs(trackWidth - 64) < 0.5 && Math.abs(width - 30) < 0.5 && Math.abs(x - (expected ? 32 : 2)) < 0.5;
  }, checked);
}
async function inProcessRadioSelected() {
  return wallet.getByTestId('proof-server-in-process-radio').evaluate(async element => {
    // RadioButton module2768 renders this marker for selected OR focus/hover.
    // React hover/focus state may settle after the DOM pseudo-state changes.
    await new Promise(requestAnimationFrame);
    const local = element.ownerDocument.querySelector('[data-testid="proof-server-local-host-radio"]');
    const otherModes = [...element.ownerDocument.querySelectorAll('[data-testid^="proof-server-"][data-testid$="-radio"]')]
      .filter(control => control !== element);
    return element.isConnected && !element.matches(':hover, :active, :focus-within')
      && element.querySelector('[data-testid="proof-server-in-process-radio-checkmark"]') !== null
      && local !== null && !local.matches(':hover, :active, :focus-within')
      && otherModes.every(control => !control.matches(':hover, :active, :focus-within')
        && control.querySelector('[data-testid$="-checkmark"]') === null);
  });
}
async function waitForInProcessRadioSelection() {
  let stableSince = 0;
  await poll(async () => {
    if (!await inProcessRadioSelected()) { stableSince = 0; return false; }
    if (!stableSince) stableSince = Date.now();
    return Date.now() - stableSince >= 250;
  }, 10_000, 50);
}
function normalSettingsControlUsable(visible, enabled, ariaDisabled) {
  // Signed RN Web createDOMProps emits aria-disabled only when it is true.
  // Its omission is ordinary enabled rendering, not a literal "false" value.
  return visible === true && enabled === true && (ariaDisabled === null || ariaDisabled === 'false');
}
async function provingSettingsUsable() {
  const usable = await Promise.all(['proof-server-in-process-radio', 'save-configuration-button'].map(async id => {
    const control = wallet.getByTestId(id);
    return normalSettingsControlUsable(await control.isVisible(), await control.isEnabled(),
      await control.getAttribute('aria-disabled'));
  }));
  return usable.every(Boolean);
}
async function bounded(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { const error = new Error('CI stage timed out'); safeFailures.set(error, 'bounded-stage-timeout'); reject(error); }, Math.max(1, milliseconds));
    })]);
  } finally { clearTimeout(timer); }
}
async function poll(check, timeout = 60_000, interval = 500) {
  const deadline = Math.min(overallDeadline, Date.now() + timeout);
  while (Date.now() < deadline) { if (shuttingDown) fail('runner-interrupted'); const value = await bounded(Promise.resolve().then(check), deadline - Date.now()); if (value) return value; await delay(interval); }
  fail('bounded-stage-timeout');
}
function publicAddress(value, type, codec) {
  requireThat(typeof value === 'string' && value.length <= 512 && value.startsWith(`mn_${type}_preview1`), 'invalid-public-preview-address');
  const parsed = codec.MidnightBech32m.parse(value);
  parsed.decode(type === 'addr' ? codec.UnshieldedAddress : codec.DustAddress, 'preview');
  requireThat(parsed.asString() === value, 'noncanonical-public-address');
  return value;
}
function redactedServiceUrl(value) {
  const url = new URL(value);
  return { origin: url.origin, pathname: url.pathname, queryKeys: [...url.searchParams.keys()].sort() };
}
function vendorPreviewService(value, kind) {
  requireThat(typeof value === 'string' && value.length < 1024, 'invalid-public-vendor-service');
  const url = new URL(value), indexer = kind === 'indexer';
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port
    && url.hostname === (indexer ? 'midnight-preview.blockfrost.io' : 'rpc.midnight-preview.blockfrost.io')
    && url.pathname === (indexer ? '/api/v0' : '/') && [...url.searchParams.keys()].join('|') === 'project_id'
    && url.searchParams.get('project_id').length >= 1 && url.searchParams.get('project_id').length <= 256,
  'invalid-public-vendor-service');
  const websocket = new URL(url);
  // Signed Lace helper4694 preserves the query and appends /ws to the path.
  websocket.protocol = 'wss:'; websocket.pathname = websocket.pathname.replace(/\/+$/, '') + '/ws';
  return [url.href, websocket.href];
}
function applyPublicVendorFlags(bytes) {
  requireThat(bytes.length <= 1024 * 1024, 'oversized-public-configuration');
  const body = JSON.parse(decodeJsonUtf8(bytes, { maxBytes: 1024 * 1024 }));
  requireThat(!body.errorsWhileComputingFlags && !(Array.isArray(body.quotaLimited)
    && body.quotaLimited.includes('feature_flags')), 'incomplete-public-vendor-configuration');
  const urls = {};
  for (const [kind, key] of [['indexer', 'BLOCKCHAIN_MIDNIGHT_INDEXER_URLS'], ['node', 'BLOCKCHAIN_MIDNIGHT_NODE_URLS']]) {
    const flag = body?.flags?.[key];
    requireThat(flag?.enabled === true, 'public-preview-service-override-unavailable');
    const payload = typeof flag.metadata?.payload === 'string' ? JSON.parse(flag.metadata.payload) : flag.metadata?.payload;
    urls[kind] = vendorPreviewService(payload?.preview, kind);
  }
  for (const value of Object.values(urls).flat()) walletVendorServiceUrls.add(value);
  report.vendorServiceConfiguration = { source: 'signed-wallet-normal-public-feature-service',
    indexer: redactedServiceUrl(urls.indexer[0]), indexerWs: redactedServiceUrl(urls.indexer[1]),
    node: redactedServiceUrl(urls.node[0]), nodeWs: redactedServiceUrl(urls.node[1]), queryValuesExported: false };
}
function validPublicConfigurationRequest(request) {
  try {
    if (request.url() !== LACE_FLAGS_URL) return false;
    if (request.method() === 'OPTIONS') return request.headers()['access-control-request-method'] === 'POST';
    if (request.method() !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers()['content-type'] ?? '')) return false;
    const bytes = request.postDataBuffer();
    if (!bytes || bytes.length > 8192) return false;
    const body = parseStrictJson(decodeJsonUtf8(bytes, { maxBytes: 8192 }), { maxBytes: 8192, maxDepth: 4 });
    exactKeys(body, ['token', 'distinct_id', 'groups', 'person_properties', 'group_properties']);
    exactKeys(body.groups, []); exactKeys(body.group_properties, []);
    exactKeys(body.person_properties, ['distinct_id', '$app_version']);
    return typeof body.token === 'string' && body.token.length === 48 && hash(body.token) === LACE_PUBLIC_CLIENT_TOKEN_SHA
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.distinct_id)
      && body.person_properties.distinct_id === body.distinct_id && body.person_properties.$app_version === LACE_VERSION;
  } catch { return false; }
}
async function readPublicResponse(response, limit = 1024 * 1024) {
  requireThat(response.ok && response.body, 'public-service-request-failed');
  const reader = response.body.getReader(), chunks = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength; requireThat(total <= limit, 'oversized-public-response'); chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}
async function preparePublicVendorPolicy(extension) {
  const source = await readFile(join(extension, 'js/injected-script.js'), 'utf8');
  const token = /POSTHOG_API_TOKEN\s*:\s*["']([^"']+)/.exec(source)?.[1];
  requireThat(typeof token === 'string' && token.length === 48 && hash(token) === LACE_PUBLIC_CLIENT_TOKEN_SHA,
    'signed-public-configuration-token-mismatch');
  // This unrelated random UUID is only for a public metadata read. It is never
  // installed into Lace and has no relation to its wallet or installation ID.
  const id = randomUUID();
  const response = await fetch(LACE_FLAGS_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, distinct_id: id, groups: {},
      person_properties: { distinct_id: id, $app_version: LACE_VERSION }, group_properties: {} }) });
  applyPublicVendorFlags(await readPublicResponse(response));
  report.publicConfigurationPreflight = true; await save();
}
async function checkWalletIndexerBeforeFunding(uri, wsUri) {
  requireThat(walletVendorServiceUrls.has(new URL(uri).href), 'wallet-public-service-override-required');
  const response = await fetch(uri, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query CiPublicHead { block { height } }' }) });
  const body = JSON.parse(decodeJsonUtf8(await readPublicResponse(response), { maxBytes: 1024 * 1024 }));
  requireThat(!body.errors && Number.isSafeInteger(body?.data?.block?.height) && body.data.block.height >= 0,
    'wallet-indexer-head-unavailable');
  report.walletIndexerHealth = { checkedBeforeFunding: true, source: 'configured-wallet-indexer-public-read',
    status: response.status, blockHeight: body.data.block.height, independentChainVerification: false };
  requireThat(walletVendorServiceUrls.has(new URL(wsUri).href), 'wallet-public-websocket-override-required');
  const subscriptionHeight = await new Promise((resolveHeight, reject) => {
    const socket = new WebSocket(wsUri, 'graphql-transport-ws'); let ended = false;
    const stop = (height) => {
      if (ended) return; ended = true; clearTimeout(timer); socket.close();
      if (height !== undefined) resolveHeight(height);
      else { const error = new Error('Public subscription unavailable'); safeFailures.set(error, 'wallet-public-block-subscription-unavailable'); reject(error); }
    };
    const timer = setTimeout(() => stop(), 45_000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'connection_init' })));
    socket.addEventListener('message', event => {
      try {
        if (typeof event.data !== 'string' || event.data.length > 16_384) return stop();
        const message = JSON.parse(event.data);
        if (message.type === 'connection_ack') socket.send(JSON.stringify({ id: 'ci-public-head', type: 'subscribe',
          payload: { query: 'subscription CiPreviewBlock { blocks { height } }' } }));
        else if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
        else if (message.type === 'next' && message.id === 'ci-public-head') {
          const height = message.payload?.data?.blocks?.height;
          if (message.payload?.errors || !Number.isSafeInteger(height) || height < 0) return stop();
          stop(height);
        } else if (message.type === 'error') stop();
      } catch { stop(); }
    });
    socket.addEventListener('error', () => stop()); socket.addEventListener('close', () => stop());
  });
  report.walletIndexerHealth.subscriptionBlockHeight = subscriptionHeight;
  report.walletIndexerHealth.websocketProtocol = 'graphql-transport-ws';
  report.walletIndexerHealth.walletSyncAttested = false;
  await save();
}
function allowedNetworkUrl(value, method = 'GET') {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.origin === origin) return ['GET', 'HEAD'].includes(method) && !url.search;
    if (url.protocol === 'chrome-extension:') return url.host === EXTENSION_ID;
    if (url.protocol === 'https:' || url.protocol === 'wss:') {
      if (url.port) return false;
      if (walletVendorServiceUrls.has(url.href)) return url.protocol === 'wss:' ? method === 'GET' : ['GET', 'POST', 'OPTIONS'].includes(method);
      if (url.search) return false;
      if (url.hostname === 'rpc.preview.midnight.network') return url.pathname === '/' && ['GET', 'POST', 'OPTIONS'].includes(method);
      if (url.hostname === 'indexer.preview.midnight.network') return ['/api/v4/graphql', '/api/v4/graphql/ws'].includes(url.pathname) && ['GET', 'POST', 'OPTIONS'].includes(method);
      if (url.hostname === 'blockfrost.lw.iog.io') return /^\/midnight-preview(?:-rpc)?\/(?:ws)?$/.test(url.pathname) && ['GET', 'POST', 'OPTIONS'].includes(method);
      // Public proving material only; exact signed-package paths are checked
      // below when the current Lace acquisition policy is loaded.
      return walletPublicAssetPaths.has(url.href) && ['GET', 'HEAD'].includes(method);
    }
    return false;
  } catch { return false; }
}
function countBlockedRequest(value) {
  let category = 'invalidUrl';
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) category = 'queryOrCredentials';
    else if (url.port && url.origin !== origin) category = 'unexpectedPort';
    else if (['127.0.0.1', 'localhost', 'rpc.preview.midnight.network', 'indexer.preview.midnight.network',
      'blockfrost.lw.iog.io', 'srs.midnight.network'].includes(url.hostname)) category = 'unexpectedKnownPathOrMethod';
    else category = 'unknownHost';
  } catch { /* Count only the fixed category; never retain a URL or payload. */ }
  traffic.blockedRequestCategories[category]++;
  traffic.blockedKnownPaths[knownRequestPathLabel(value)]++;
}
function knownRequestPathLabel(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'e.lw.iog.io') {
      if (url.pathname === '/flags/') return 'wallet-public-flags';
      if (['/batch/', '/capture/', '/api/surveys/'].includes(url.pathname)) return 'wallet-telemetry';
      return 'wallet-config-other-path';
    }
    if (url.hostname === 'midnight-preview.blockfrost.io')
      return ['/api/v0', '/api/v0/ws'].includes(url.pathname) ? 'wallet-indexer-current' : 'wallet-indexer-current-other-path';
    if (url.hostname === 'rpc.midnight-preview.blockfrost.io')
      return ['/', '/ws'].includes(url.pathname) ? 'wallet-node-current' : 'wallet-node-current-other-path';
    if (url.hostname === 'blockfrost.lw.iog.io') {
      if (/^\/midnight-preview\/(?:ws)?$/.test(url.pathname)) return 'wallet-indexer-retired';
      if (/^\/midnight-preview-rpc\/(?:ws)?$/.test(url.pathname)) return 'wallet-node-retired';
    }
    if (url.hostname === 'srs.midnight.network') return 'public-proving-assets';
    if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '6300') return 'loopback-prover';
  } catch { /* Only the fixed label is emitted. */ }
  return 'other';
}
const walletPublicAssetPaths = new Set([
  ...['spend', 'output', 'sign'].flatMap(circuit => ['prover', 'verifier', 'bzkir']
    .map(kind => `https://srs.midnight.network/zswap/9/${circuit}.${kind}`)),
  ...['prover', 'verifier', 'bzkir'].map(kind => `https://srs.midnight.network/dust/9/spend.${kind}`),
  ...Array.from({ length: 26 }, (_, k) => `https://srs.midnight.network/bls_midnight_2p${k}`),
]);
async function startServer() {
  const dist = await realpath(join(root, 'dist'));
  const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const instance = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.search) return response.writeHead(400).end();
      const path = resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!path.startsWith(dist + sep)) return response.writeHead(403).end();
      const actual = await realpath(path);
      if (!actual.startsWith(dist + sep)) return response.writeHead(403).end();
      const bytes = await readFile(actual);
      response.writeHead(200, { 'Content-Type': types[extname(actual)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', done); });
  return instance;
}
function watchPage(page) {
  page.on('pageerror', () => { traffic.pageErrors++; });
  page.on('console', message => {
    // Count categories only. Never inspect or retain an extension log payload.
    if (message.type() === 'error') traffic.consoleErrors++;
    if (message.type() === 'warning') traffic.consoleWarnings++;
  });
}
async function panel(name) {
  await app.locator(`.network-steps [data-network-nav="${name}"]`).click();
  await app.locator(`#network-panel-${name}`).waitFor({ state: 'visible' });
}
async function appIdle() {
  await app.waitForFunction(() => !document.querySelector('.network-steps [data-network-nav="connect"]').disabled,
    null, { timeout: 30_000 });
}
async function publicApi(includeBalances = false) {
  requireThat(!configurationFailure, 'invalid-wallet-public-configuration-response');
  const value = await bounded(app.evaluate(async balances => {
    const entries = Object.values(window.midnight ?? {}).filter(item => item.rdns === 'io.lace.wallet');
    if (entries.length !== 1) throw new Error('One actual Lace API is required');
    const initial = entries[0], api = await initial.connect('preview');
    const config = await api.getConfiguration(), connection = await api.getConnectionStatus();
    const { unshieldedAddress } = await api.getUnshieldedAddress(), { dustAddress } = await api.getDustAddress();
    const result = { apiVersion: initial.apiVersion, networkId: connection.networkId, status: connection.status,
      unshieldedAddress, dustAddress, configuration: { networkId: config.networkId, indexerUri: config.indexerUri,
        indexerWsUri: config.indexerWsUri, substrateNodeUri: config.substrateNodeUri,
        externalProverReported: typeof config.proverServerUri === 'string' && config.proverServerUri.length > 0 } };
    if (balances) {
      const unshielded = await api.getUnshieldedBalances(), dust = await api.getDustBalance();
      result.balances = { night: String(unshielded['0'.repeat(64)] ?? 0n), dust: String(dust.balance), dustCap: String(dust.cap) };
    }
    return result;
  }, includeBalances), 30_000);
  requireThat(value.apiVersion === LACE_API_VERSION && value.status === 'connected' && value.networkId === 'preview'
    && value.configuration.networkId === 'preview' && !value.configuration.externalProverReported, 'wallet-network-or-proving-mode-boundary');
  for (const field of ['indexerUri', 'indexerWsUri', 'substrateNodeUri']) {
    requireThat(allowedNetworkUrl(value.configuration[field], 'GET'), 'unexpected-wallet-service');
  }
  if (value.balances) for (const amount of Object.values(value.balances)) requireThat(/^(0|[1-9][0-9]{0,99})$/.test(amount), 'invalid-public-balance');
  if (publicIdentity) requireThat(value.unshieldedAddress === publicIdentity.unshieldedAddress
    && value.dustAddress === publicIdentity.dustAddress, 'wallet-account-changed');
  return value;
}
async function approval(route, timeout) {
  return poll(async () => {
    const pages = browserContext.pages().filter(page => page.url().startsWith(extensionOrigin + '/') && page.url().includes(route));
    requireThat(pages.length <= 1, 'ambiguous-wallet-approval');
    if (pages[0] && await pages[0].getByTestId('dapp-connector-primary-button').isVisible().catch(() => false)) return pages[0];
    if (currentOperation && await app.locator('#network-operation-feedback.is-active').count() === 0) fail('application-ended-before-wallet-approval');
    return null;
  }, timeout);
}
async function authenticate(page) {
  await page.getByTestId('authentication-prompt-input-value').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('authentication-prompt-input-value').fill(walletPassword);
  await page.getByTestId('authentication-prompt-button-confirm').click();
}
async function operation(label, button, metadata = {}) {
  await setStage(`operation-${button.replace('network-', '')}`);
  await publicApi();
  const deadline = Date.now() + 20 * 60_000;
  const remaining = () => { const time = Math.min(deadline, overallDeadline) - Date.now(); if (time <= 0) fail('operation-timeout'); return time; };
  const op = { ordinal: report.operations.length + 1, operation: label, ...metadata, status: 'requested',
    startedAt: new Date().toISOString(), contractCallProofRequired: label !== 'Deployment', phases: [],
    confirmationSource: 'configured-indexer', ledgerInclusionIndependentlyVerified: false };
  report.operations.push(op); currentOperation = op;
  await save(); // Journal before the sole initiating click; never retry it.
  await app.locator(`#${button}`).click();
  const page = await approval('#/prove-midnight-transaction', remaining());
  requireThat((await page.getByTestId('dapp-info-url').textContent()).trim() === origin, 'wallet-approval-origin-mismatch');
  op.walletApprovalRequestedAt = new Date().toISOString(); await save();
  await poll(() => page.getByTestId('dapp-connector-primary-button').isEnabled(), remaining());
  await page.getByTestId('dapp-connector-primary-button').click();
  await authenticate(page);
  op.walletApprovalConfirmedAt = new Date().toISOString(); await save();
  const confirmation = await poll(async () => {
    const texts = await app.locator('#network-events p').allTextContents();
    const found = texts.find(text => text.startsWith(`${label}: configured indexer confirmed `));
    const match = found && /confirmed ([0-9a-f]{64,128}) at block ([0-9]+)\./.exec(found);
    if (match && !report.operations.some(prior => prior !== op && prior.txId === match[1])) return match;
    if (await app.locator('#network-operation-feedback.is-active').count() === 0) fail('operation-outcome-unconfirmed');
    return null;
  }, remaining());
  op.txId = confirmation[1]; op.blockHeight = Number(confirmation[2]);
  requireThat(Number.isSafeInteger(op.blockHeight), 'invalid-confirmation-height');
  op.status = 'indexer-accepted'; op.acceptedAt = new Date().toISOString(); await save();
  await appIdle();
  const address = await app.locator('#network-address').inputValue();
  requireThat(/^[0-9a-f]{64}$/.test(address) && !/^0+$/.test(address), 'invalid-public-contract-address');
  report.contractAddress = address; await save();
  const required = ['preparation-started', 'preparation-completed', 'wallet-approval-requested', 'wallet-signed', 'submission-returned'];
  await poll(() => required.every(phase => op.phases.includes(phase))
    && op.phases.includes(label === 'Deployment' ? 'no-contract-proof-required' : 'contract-proof-completed'), 10_000, 100);
  requireThat(required.every(phase => op.phases.includes(phase)), 'missing-transaction-stage-evidence');
  requireThat(op.phases.includes(label === 'Deployment' ? 'no-contract-proof-required' : 'contract-proof-completed'), 'missing-contract-proof-evidence');
  currentOperation = null; await save();
}
async function waitDeadline(timestamp, name) {
  await setStage(name);
  await poll(async () => {
    if (Date.now() < (timestamp + 5) * 1000) return false;
    const response = await fetch(INDEXER, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block { timestamp } }' }), signal: AbortSignal.timeout(15_000), redirect: 'error' });
    if (!response.ok) return false;
    const value = await response.json(), indexed = value?.data?.block?.timestamp;
    requireThat(!value.errors && Number.isSafeInteger(indexed), 'invalid-indexer-clock');
    return indexed >= timestamp * 1000;
  }, Math.max(0, timestamp * 1000 - Date.now()) + 5 * 60_000, 3000);
}
async function publicDownload(button, limit) {
  const pending = app.waitForEvent('download'); await app.locator(`#${button}`).click();
  const download = await pending;
  try {
    const stream = await download.createReadStream(); requireThat(stream, 'public-download-unavailable');
    const pieces = []; let size = 0;
    for await (const chunk of stream) { size += chunk.length; requireThat(size <= limit, 'public-download-too-large'); pieces.push(chunk); }
    return Buffer.concat(pieces).toString('utf8');
  } finally { await download.delete(); }
}
function exactKeys(value, keys) { requireThat(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|'), 'unexpected-public-export-fields'); }
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  walletPassword = undefined; appPassword = undefined;
  await browserContext?.close().catch(() => {});
  if (server) await new Promise(done => server.close(done));
  // Only our fresh child directory is removed; evidence is a separate sibling.
  if (profileRoot && profileRoot.startsWith((await realpath(process.env.RUNNER_TEMP)) + sep)) await rm(profileRoot, { recursive: true, force: true });
}
async function emergencyFailure(category) {
  report.status = 'failed'; report.failureCategory = category; report.failedStage = stage;
  if (currentOperation?.status === 'requested') currentOperation.status = 'uncertain';
  if (['approval-requested', 'awaiting-wallet-sync'].includes(report.dustRegistration?.status)) report.dustRegistration.status = 'uncertain';
  await save().catch(() => {});
  await Promise.race([shutdown().catch(() => {}), delay(10_000)]);
  process.exit(1);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void emergencyFailure('runner-interrupted'); });
process.once('unhandledRejection', () => { void emergencyFailure('unhandled-runtime-failure'); });
process.once('uncaughtException', () => { void emergencyFailure('uncaught-runtime-failure'); });
const watchdog = setTimeout(() => { void emergencyFailure('overall-timeout'); }, overallDeadline - Date.now());
watchdog.unref();

try {
  requireThat(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux' && process.env.DISPLAY,
    'ci-linux-display-required');
  // Playwright debug logging can include fill() arguments. It must never be
  // enabled for this secret-bearing disposable wallet run.
  delete process.env.DEBUG; delete process.env.PWDEBUG;
  requireThat(process.env.LACE_ONBOARDING_APPROVAL === 'lace-2.5.1-create-terms-and-privacy',
    'explicit-Lace-Create-terms-approval-required');
  requireThat(/^[1-9][0-9]{0,24}$/.test(process.env.GITHUB_RUN_ID ?? '') && /^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? ''), 'trusted-run-metadata-required');
  requireThat(process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF === 'refs/heads/main'
    && process.env.GITHUB_RUN_ATTEMPT === '1' && process.env.GITHUB_REPOSITORY?.toLowerCase() === 'ibkr-bouncybot/midnight-ballotlab',
    'trusted-manual-first-main-run-required');
  const temp = await realpath(process.env.RUNNER_TEMP);
  for (const name of ['LACE_EXTENSION_PATH', 'LACE_ACQUISITION_REPORT', 'LACE_EVIDENCE_DIR']) {
    requireThat(typeof process.env[name] === 'string' && resolve(process.env[name]).startsWith(temp + sep), 'task-temp-path-required');
  }
  output = resolve(process.env.LACE_EVIDENCE_DIR); await mkdir(output, { recursive: true });
  requireThat((await realpath(output)).startsWith(temp + sep), 'evidence-path-escape');
  // New runs must not overwrite a prior transaction journal or funding request.
  await writeFile(join(output, 'run-reservation'), 'fresh CI acceptance\n', { flag: 'wx', mode: 0o600 });
  canSave = true; report.runId = process.env.GITHUB_RUN_ID; report.headSha = process.env.GITHUB_SHA;
  journal.runId = report.runId; journal.headSha = report.headSha;
  const acquisition = JSON.parse(await readFile(process.env.LACE_ACQUISITION_REPORT, 'utf8'));
  const extension = await realpath(process.env.LACE_EXTENSION_PATH);
  requireThat(extension.startsWith(temp + sep), 'extension-path-escape');
  const manifestBytes = await readFile(join(extension, 'manifest.json')), manifest = JSON.parse(manifestBytes);
  requireThat(hash(manifestBytes) === EXTENSION_MANIFEST_SHA && manifest.version === LACE_VERSION, 'signed-extension-manifest-mismatch');
  const walletWasmBytes = await readFile(join(extension, WALLET_PROVER_WASM));
  requireThat(walletWasmBytes.length === WALLET_PROVER_WASM_BYTES && hash(walletWasmBytes) === WALLET_PROVER_WASM_SHA,
    'signed-wallet-prover-WASM-mismatch');
  // Acquisition's exact public schema is pinned by ci-acquire-lace.mjs.
  requireThat(acquisition.schema === 'midnight-ballot-lab/official-lace-acquisition/v1' && acquisition.version === LACE_VERSION
    && acquisition.archiveSha256 === EXTENSION_ARCHIVE_SHA && acquisition.manifestSha256 === EXTENSION_MANIFEST_SHA && acquisition.extensionId === EXTENSION_ID
    && acquisition.developerSignatureVerified === true && acquisition.webStorePublisherSignatureVerified === true,
    'verified-extension-acquisition-required');
  report.laceVersion = LACE_VERSION; report.extensionId = EXTENSION_ID; report.extensionArchiveSha256 = EXTENSION_ARCHIVE_SHA;
  report.runnerSha256 = hash(await readFile(fileURLToPath(import.meta.url)));
  const build = JSON.parse(await readFile(join(root, 'dist/network-build.json'), 'utf8'));
  requireThat(build.enabled === true && build.browserProver?.version === '2.1.1', 'real-browser-prover-build-required');
  report.networkBundleSha256 = hash(await readFile(join(root, 'dist/network-bundle.mjs')));
  report.workerSha256 = build.browserProver.worker.sha256;
  const { chromium } = requireContracts('playwright');
  const addressPackage = join(root, 'contracts/node_modules/@midnight-ntwrk/wallet-sdk-address-format');
  const addressManifest = JSON.parse(await readFile(join(addressPackage, 'package.json'), 'utf8'));
  requireThat(addressManifest.name === '@midnight-ntwrk/wallet-sdk-address-format' && addressManifest.version === '3.1.2'
    && addressManifest.exports?.['.']?.import === './dist/index.js', 'official-address-codec-entry-required');
  const addressCodec = await import(pathToFileURL(join(addressPackage, 'dist/index.js')).href);
  const { validatePassword } = await import(pathToFileURL(requireContracts.resolve('@midnight-ntwrk/midnight-js-utils').replace(/\.cjs$/, '.mjs')).href);
  report.playwright = requireContracts('playwright/package.json').version;
  await setStage('read-signed-wallet-public-service-configuration');
  await preparePublicVendorPolicy(extension);
  profileRoot = await mkdtemp(join(temp, 'lace-preview-wallet-'));
  server = await startServer(); origin = `http://127.0.0.1:${server.address().port}`;
  await setStage('start-genuine-extension');
  const allowedHosts = ['127.0.0.1', 'localhost', 'indexer.preview.midnight.network', 'rpc.preview.midnight.network',
    'blockfrost.lw.iog.io', 'e.lw.iog.io', 'midnight-preview.blockfrost.io', 'rpc.midnight-preview.blockfrost.io',
    ...new Set([...walletPublicAssetPaths].map(path => new URL(path).hostname))];
  browserContext = await chromium.launchPersistentContext(join(profileRoot, 'profile'), {
    channel: 'chromium', headless: false, viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      `--host-resolver-rules=MAP * ~NOTFOUND, ${allowedHosts.map(host => `EXCLUDE ${host}`).join(', ')}`],
  });
  browserContext.setDefaultTimeout(45_000); report.chromium = browserContext.browser().version();
  browserContext.on('page', watchPage); browserContext.pages().forEach(watchPage);
  await browserContext.route(/^https?:\/\//, route => {
    if (validPublicConfigurationRequest(route.request())) {
      traffic.publicConfigurationRequests++; return route.continue();
    }
    if (allowedNetworkUrl(route.request().url(), route.request().method())) return route.continue();
    traffic.blockedRequests++; countBlockedRequest(route.request().url()); return route.abort('blockedbyclient');
  });
  await browserContext.routeWebSocket(/.*/, socket => {
    if (allowedNetworkUrl(socket.url(), 'GET') && new URL(socket.url()).protocol === 'wss:') socket.connectToServer();
    else { traffic.blockedWebSockets++; socket.close(); }
  });
  browserContext.on('response', response => {
    const url = response.url();
    if (response.ok() && validPublicConfigurationRequest(response.request()) && response.request().method() === 'POST') {
      configurationResponses.push((async () => {
        applyPublicVendorFlags(await response.body()); traffic.publicConfigurationResponses++;
      })().catch(() => { configurationFailure = true; }));
    }
    if (response.ok() && url === `${extensionOrigin}/${WALLET_PROVER_WASM}`) {
      walletWasmObservations.push((async () => {
        const bytes = await response.body();
        requireThat(bytes.length === WALLET_PROVER_WASM_BYTES && hash(bytes) === WALLET_PROVER_WASM_SHA,
          'loaded-wallet-prover-WASM-mismatch');
        report.walletProverWasm = { observed: true, bytes: bytes.length, sha256: hash(bytes), evidence: 'actual-browser-resource-response' };
      })());
    }
    if (response.ok() && url.endsWith('.wasm')) {
      if (url.startsWith(extensionOrigin + '/')) traffic.walletWasmResources++;
      else if (url.startsWith(origin + '/')) traffic.appWasmResources++;
    }
  });
  wallet = await browserContext.newPage(); await wallet.goto(`${extensionOrigin}/expo/index.html`);
  await setStage('observe-normal-wallet-public-service-configuration');
  const normalConfigurationReady = () => {
    requireThat(!configurationFailure, 'invalid-wallet-public-configuration-response');
    return traffic.publicConfigurationResponses > 0;
  };
  try { await poll(normalConfigurationReady, 15_000, 250); }
  catch (error) {
    if (safeFailures.get(error) !== 'bounded-stage-timeout') throw error;
    // A worker can start before Playwright attaches. One ordinary page reload
    // before creating a wallet lets Lace fetch its own public configuration.
    // It does not insert flags, modify storage, or retry a wallet operation.
    report.walletPublicConfigurationReloaded = true;
    await setStage('reload-wallet-before-creation-for-public-configuration');
    await wallet.reload({ waitUntil: 'domcontentloaded' });
    await poll(normalConfigurationReady, 30_000, 250);
  }
  await setStage('create-fresh-test-wallet');
  const freshPassword = prefix => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const candidate = `${prefix}-${randomBytes(24).toString('base64url')}!9a`;
      try { validatePassword(candidate); return candidate; } catch { /* Regenerate locally; never print the rejected secret. */ }
    }
    fail('local-password-generation-failed');
  };
  walletPassword = freshPassword('CI'); appPassword = freshPassword('App');
  await wallet.getByTestId('onboarding-start-create-wallet-button').click();
  await wallet.getByTestId('new-password-input-value').fill(walletPassword);
  await wallet.getByTestId('confirm-password-input-value').fill(walletPassword);
  await wallet.getByTestId('next-btn').click();
  // Lace refuses to deselect the last enabled account. Enable Midnight first,
  // then remove Cardano so this isolated test creates only its intended chain.
  await setStage('enable-midnight-onboarding-account');
  await wallet.getByTestId('onboarding-create-wallet-toggle-midnight').click();
  await clearWalletPointerAndFocus('onboarding-create-wallet-finish-button');
  await poll(() => onboardingToggleMatches('onboarding-create-wallet-toggle-midnight', true), 10_000, 100);
  await setStage('disable-cardano-onboarding-account');
  await wallet.getByTestId('onboarding-create-wallet-toggle-cardano').click();
  await clearWalletPointerAndFocus('onboarding-create-wallet-finish-button');
  await poll(() => onboardingToggleMatches('onboarding-create-wallet-toggle-cardano', false), 10_000, 100);
  requireThat(await onboardingToggleMatches('onboarding-create-wallet-toggle-midnight', true),
    'midnight-only-onboarding-required');
  report.midnightOnlyAccountSelectionVerified = true; await save();
  await setStage('finish-fresh-midnight-wallet');
  await wallet.getByTestId('onboarding-create-wallet-finish-button').click();
  await wallet.getByTestId('settings-tab-btn').waitFor({ timeout: 120_000 });
  report.freshWalletCreated = true;
  await settingsClick('settings-tab-btn', 'open-wallet-settings');
  await settingsClick('option-list-item-network', 'open-wallet-network-settings');
  await settingsClick('radio-button-testnet', 'select-wallet-testnet');
  await settingsClick('radio-button-midnight-preview', 'select-wallet-midnight-preview');
  await settingsClick('network-selection-sheet-confirm-button', 'save-wallet-preview-network');
  await setStage('wait-wallet-network-sheet-close');
  await wallet.getByTestId('network-selection-sheet').waitFor({ state: 'hidden' });
  await settingsClick('option-list-item-midnight', 'open-wallet-proving-settings');
  // Exact current selectors are verified from the signed Lace source before CI.
  await settingsClick('proof-server-in-process-radio', 'select-wallet-on-device-wasm');
  await clearWalletPointerAndFocus('save-configuration-button');
  await waitForInProcessRadioSelection();
  await settingsModeSnapshot('before-save');
  report.walletSettingsSaveActivations = ['mouse'];
  await settingsClick('save-configuration-button', 'save-wallet-on-device-wasm');
  await setStage('wait-wallet-proving-settings-close');
  const provingHeader = wallet.getByTestId('midnight-settings-sheet-header');
  const automaticallyClosed = await provingHeader.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
  if (!automaticallyClosed) {
    // One ordinary keyboard activation is a bounded reversible settings retry.
    // It must not dismiss an unsaved mode or retry any wallet transaction.
    await setStage('wait-wallet-proving-save-controls-usable');
    await poll(provingSettingsUsable, 45_000, 100);
    await clearWalletPointerAndFocus('save-configuration-button');
    await waitForInProcessRadioSelection();
    await settingsModeSnapshot('before-keyboard-save');
    report.walletSettingsSaveActivations.push('keyboard-enter');
    await setStage('save-wallet-on-device-wasm-keyboard');
    await wallet.getByTestId('save-configuration-button').press('Enter');
    await setStage('wait-keyboard-wallet-proving-settings-close');
    await provingHeader.waitFor({ state: 'hidden', timeout: 10_000 });
  }
  await wallet.getByTestId('proof-server-in-process-radio').waitFor({ state: 'detached' });
  report.walletSettingsClose = automaticallyClosed ? 'automatic-after-mouse-save' : 'automatic-after-keyboard-save'; await save();
  await settingsClick('option-list-item-midnight', 'reopen-wallet-proving-settings');
  await setStage('verify-persisted-wallet-on-device-selection');
  await clearWalletPointerAndFocus('save-configuration-button');
  await settingsModeSnapshot('after-reopen');
  await waitForInProcessRadioSelection();
  await settingsClick('side-sheet-close-button', 'close-reviewed-wallet-proving-settings', { visibleOnly: true });
  await setStage('wait-reviewed-wallet-proving-settings-close');
  await wallet.getByTestId('midnight-settings-sheet-header').waitFor({ state: 'hidden' });
  await settingsClick('portfolio-tab-btn', 'return-wallet-portfolio');
  report.walletOnDeviceWasmSelectedThroughUi = true;
  await setStage('connect-genuine-application');
  app = await browserContext.newPage(); await app.goto(origin + '/network.html');
  await app.waitForFunction(() => document.getElementById('network-availability')?.dataset.state === 'ready');
  await app.exposeFunction('__ciPublicPhase', async phase => {
    if (!currentOperation || !new Set(allowedPublicPhases.values()).has(phase)) return;
    if (!currentOperation.phases.includes(phase)) { currentOperation.phases.push(phase); await save(); }
  });
  await app.evaluate(entries => {
    const phases = new Map(entries), status = document.getElementById('network-status');
    new MutationObserver(changes => {
      for (const change of changes) for (const node of change.addedNodes) {
        const phase = phases.get(node.textContent); if (phase) void globalThis.__ciPublicPhase(phase);
      }
    }).observe(status, { childList: true });
  }, [...allowedPublicPhases]);
  requireThat(await app.locator('#network-id').inputValue() === 'preview', 'application-preview-required');
  await app.locator('#network-password').fill(appPassword); await app.locator('#network-connect').click();
  const permission = await approval('#/midnight-authorize-dapp', 180_000);
  requireThat((await permission.getByTestId('dapp-info-url').textContent()).trim() === origin, 'wallet-permission-origin-mismatch');
  await permission.getByTestId('dropdown-button').click(); await permission.getByTestId('dropdown-menu-item-0').click();
  await permission.getByTestId('dapp-connector-primary-button').click();
  await app.waitForFunction(() => document.getElementById('network-status').textContent.startsWith('Connected to preview.'), null, { timeout: 240_000 });
  const metadata = await publicApi();
  publicIdentity = { unshieldedAddress: publicAddress(metadata.unshieldedAddress, 'addr', addressCodec),
    dustAddress: publicAddress(metadata.dustAddress, 'dust', addressCodec) };
  report.apiVersion = metadata.apiVersion; report.walletConnected = true;
  report.walletServices = { networkId: metadata.configuration.networkId,
    indexerUri: redactedServiceUrl(metadata.configuration.indexerUri),
    indexerWsUri: redactedServiceUrl(metadata.configuration.indexerWsUri),
    substrateNodeUri: redactedServiceUrl(metadata.configuration.substrateNodeUri),
    externalProverReported: metadata.configuration.externalProverReported, queryValuesExported: false };
  await Promise.all(configurationResponses);
  requireThat(!configurationFailure && traffic.publicConfigurationResponses > 0, 'normal-wallet-public-configuration-required');
  requireThat(['indexerUri', 'indexerWsUri', 'substrateNodeUri'].every(field =>
    walletVendorServiceUrls.has(new URL(metadata.configuration[field]).href)), 'wallet-current-vendor-services-required');
  await setStage('check-wallet-indexer-before-funding');
  await checkWalletIndexerBeforeFunding(metadata.configuration.indexerUri, metadata.configuration.indexerWsUri);
  const unfunded = await publicApi(true);
  requireThat(Object.values(unfunded.balances).every(value => value === '0'), 'fresh-unfunded-wallet-required');
  report.walletBalanceApiBeforeFunding = { responded: true, balancesZero: true, walletSyncAttested: false };
  await setStage('waiting-for-authorized-test-funding');
  const request = { schema: 'midnight-ballot-lab/lace-preview-funding-request/v1', networkId: 'preview',
    runId: report.runId, headSha: report.headSha, nonce: randomBytes(32).toString('hex'),
    unshieldedAddress: publicIdentity.unshieldedAddress, laceVersion: LACE_VERSION, extensionId: EXTENSION_ID,
    maximumFundingAtomic: '5000000000' };
  await atomic('funding-request.json', request);
  report.fundingRequestSha256 = hash(JSON.stringify(request, null, 2) + '\n'); await save();
  await poll(async () => BigInt((await publicApi(true)).balances.night) > 0n, 60 * 60_000, 5000);
  report.testNightObserved = true; await save();
  await setStage('generate-test-dust-through-wallet-ui');
  // No SDK registration/signing replaces these wallet controls.
  report.dustRegistration = { status: 'preparing', startedAt: new Date().toISOString(),
    scope: 'separate-wallet-UI-operation-not-one-of-nine-application-transactions', ledgerInclusionIndependentlyVerified: false };
  journal.dustRegistration = report.dustRegistration; await save();
  await wallet.getByTestId('account-card-generate-dust-button').click();
  const dustRecipient = wallet.getByTestId('dust-address-input-value');
  await dustRecipient.waitFor({ state: 'visible' });
  const displayedDustAddress = await dustRecipient.inputValue();
  requireThat(displayedDustAddress === '' || displayedDustAddress === publicIdentity.dustAddress,
    'wallet-dust-recipient-mismatch');
  if (displayedDustAddress === '') await dustRecipient.fill(publicIdentity.dustAddress);
  requireThat(await dustRecipient.inputValue() === publicIdentity.dustAddress, 'wallet-own-dust-address-required');
  await poll(() => wallet.getByTestId('designate-button').isEnabled(), 45 * 60_000, 2000);
  await wallet.getByTestId('designate-button').click();
  await poll(() => wallet.getByTestId('confirm-designation-button').isEnabled(), 5 * 60_000, 1000);
  report.dustRegistration.status = 'approval-requested'; await save();
  await wallet.getByTestId('confirm-designation-button').click();
  await authenticate(wallet);
  report.dustRegistration.status = 'awaiting-wallet-sync'; await save();
  report.dustRegistrationUiApproved = true; await save();
  await setStage('waiting-for-usable-wallet-dust');
  await poll(async () => BigInt((await publicApi(true)).balances.dust) > 0n, 45 * 60_000, 5000);
  report.dustRegistration.status = 'positive-dust-observed'; report.dustRegistration.observedAt = new Date().toISOString();
  report.positiveDustObserved = true; await save();
  await panel('setup'); await app.locator('#network-mode-create').click();
  await app.locator('#network-title').fill('Isolated CI Preview election');
  await app.locator('#network-choices').fill('Option A\nOption B');
  await app.locator('#network-generate-admin').click(); await appIdle();
  await app.locator('#network-generate-dealer').click(); await appIdle();
  await panel('vote'); await app.locator('#network-generate-voter').click(); await appIdle();
  await panel('setup');
  const schedule = await app.evaluate(() => {
    const opens = Math.ceil(Date.now() / 60_000) * 60_000 + 15 * 60_000, closes = opens + 25 * 60_000;
    const format = time => { const d = new Date(time), p = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
    return { opensAt: opens / 1000, closesAt: closes / 1000, opensInput: format(opens), closesInput: format(closes) };
  });
  report.schedule = { opensAt: schedule.opensAt, closesAt: schedule.closesAt }; await save();
  await app.locator('#network-opens').fill(schedule.opensInput); await app.locator('#network-closes').fill(schedule.closesInput);
  await operation('Deployment', 'network-deploy'); await operation('Key configuration', 'network-configure');
  await panel('vote'); await operation('Enrollment', 'network-enroll');
  await waitDeadline(schedule.opensAt, 'wait-for-real-opening'); await operation('Voting opened', 'network-open');
  const selection = randomInt(2); await app.locator(`label[for="network-choice-${selection}"]`).click();
  await operation('Ballot', 'network-cast');
  const { decodeNetworkReceipt } = await import('../src/network-receipt.mjs');
  const code = await app.locator('#network-receipt-code').textContent(), decoded = decodeNetworkReceipt(code);
  const receiptText = await publicDownload('network-save-receipt', 4096), receipt = JSON.parse(receiptText);
  exactKeys(receipt, ['schema', 'networkId', 'contractAddress', 'index', 'receipt', 'configurationDigest', 'txId', 'blockHeight',
    'confirmationSource', 'ledgerInclusionIndependentlyVerified', 'transactionReferenceVerified']);
  requireThat(receipt.networkId === 'preview' && receipt.receipt === decoded.receipt && receipt.contractAddress === report.contractAddress
    && receipt.ledgerInclusionIndependentlyVerified === false, 'public-receipt-mismatch');
  await atomic('public-receipt.json', receipt);
  await panel('check'); await app.locator('#network-receipt-input').fill(code); await app.locator('#network-check-receipt').click();
  await app.waitForFunction(() => document.getElementById('network-status').textContent.startsWith('Your receipt matches the encrypted ballot'));
  report.receiptCheckedAgainstIndexer = true; await save();
  await waitDeadline(schedule.closesAt, 'wait-for-real-closing'); await panel('tally');
  await operation('Voting closed', 'network-close');
  for (const trustee of [1, 3]) {
    await app.locator(`label[for="network-trustee-${trustee}"]`).click();
    await app.locator('#network-use-share').click(); await appIdle();
    await operation('Trustee contribution', 'network-submit-share', { trusteeIndex: trustee });
  }
  await app.locator('label[for="network-pair-13"]').click(); await operation('Tally finalized', 'network-finalize');
  await panel('check');
  const recordText = await publicDownload('network-export', 8 * 1024 * 1024), record = JSON.parse(recordText);
  exactKeys(record, ['schema', 'source', 'networkId', 'proofPackageIncluded', 'ledgerInclusionIndependentlyVerified', 'warning',
    'contractAddress', 'electionId', 'manifestDigest', 'configurationDigest', 'keysConfigured', 'administrator', 'opensAt', 'closesAt',
    'phase', 'accepted', 'candidateCount', 'publicKey', 'coefficientKey', 'trusteeKeys', 'aggregateA', 'aggregateB', 'ballots',
    'decryptionShares', 'finalizedTotals', 'electionManifest']);
  exactKeys(record.electionManifest, ['schema', 'title', 'choices']);
  for (const ballot of record.ballots) exactKeys(ballot, ['index', 'a', 'b', 'nullifier', 'receipt']);
  for (const share of record.decryptionShares) exactKeys(share, ['index', 'values']);
  // The app's actual browser/WASM verifier rejects unexpected/private fields;
  // no Node proof generation or replacement verification is used here.
  await app.locator('#network-import-record').setInputFiles({ name: 'ci-public-election.json', mimeType: 'application/json', buffer: Buffer.from(recordText) });
  await app.waitForFunction(() => document.getElementById('network-record-file-status').textContent.startsWith('Saved record checked locally.'));
  requireThat(record.schema === 'midnight-ballot-lab/native-indexed-observation/v1' && record.source === 'configured-indexer'
    && record.networkId === 'preview' && record.contractAddress === report.contractAddress && record.keysConfigured === true
    && record.phase === 3 && record.accepted === 1 && record.candidateCount === 2
    && record.proofPackageIncluded === false && record.ledgerInclusionIndependentlyVerified === false, 'final-public-record-mismatch');
  const expected = [0, 0, 0, 0, 0]; expected[selection] = 1;
  requireThat(JSON.stringify(record.finalizedTotals) === JSON.stringify(expected), 'unexpected-public-tally');
  requireThat(record.ballots[0].receipt === receipt.receipt && JSON.stringify(record.decryptionShares.map(item => item.index)) === '[1,3]', 'receipt-or-trustee-record-mismatch');
  await atomic('public-indexed-observation.json', record);
  requireThat(report.operations.length === 9 && report.operations.every(op => op.status === 'indexer-accepted')
    && new Set(report.operations.map(op => op.txId)).size === 9, 'incomplete-accepted-flow');
  requireThat(report.operations.filter(op => op.phases.includes('contract-proof-completed')).length === 8, 'incomplete-contract-proof-evidence');
  await bounded(Promise.all(walletWasmObservations), 30_000);
  requireThat(report.walletProverWasm?.observed === true, 'wallet-prover-WASM-resource-not-observed');
  requireThat(hash(await readFile(join(root, 'dist/network-bundle.mjs'))) === report.networkBundleSha256, 'bundle-changed-during-test');
  report.finalizedTotals = record.finalizedTotals; report.publicRecordConsistent = true;
  report.acceptedApplicationTransactions = 9; report.observedContractProofCompletions = 8;
  report.walletProofScope = 'normal-Lace-on-device-setting-and-real-approved-transactions; API-does-not-attest-mode';
  report.status = 'passed'; report.finishedAt = new Date().toISOString(); await save();
} catch (error) {
  report.status = 'failed'; report.failedStage = stage;
  report.failureCategory = safeFailures.get(error)
    ?? (error?.name === 'TimeoutError' ? 'ui-stage-timeout' : 'sanitized-boundary-or-runtime-failure');
  if (currentOperation?.status === 'requested') currentOperation.status = 'uncertain';
  if (['approval-requested', 'awaiting-wallet-sync'].includes(report.dustRegistration?.status)) report.dustRegistration.status = 'uncertain';
  report.settingsControls = await bounded(settingsControlSnapshot(), 15_000).catch(() => []);
  if (wallet && !wallet.isClosed()) await bounded(settingsModeSnapshot('failure'), 10_000).catch(() => {});
  report.finishedAt = new Date().toISOString();
  await save().catch(() => {}); process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await shutdown().catch(() => { process.exitCode = 1; });
  process.stdout.write(JSON.stringify({ status: report.status, stage, acceptedApplicationTransactions: report.operations.filter(op => op.status === 'indexer-accepted').length }) + '\n');
}
