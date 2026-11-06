/** CI ONLY: genuine disposable Lace + Preview, through the normal wallet/app UI.
 * No personal profile, wallet API substitute, HTTP prover, transaction retry,
 * private checkpoint, console dump, screenshot, trace or video is produced.
 * The same browser stays alive while a separately authorized sponsor funds its
 * public address. A failure is evidence of failure, never an acceptance flag.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const traffic = { blockedRequests: 0, blockedWebSockets: 0, walletWasmResources: 0, appWasmResources: 0,
  pageErrors: 0, consoleErrors: 0, consoleWarnings: 0 };
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
function allowedNetworkUrl(value, method = 'GET') {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.origin === origin) return ['GET', 'HEAD'].includes(method) && !url.search;
    if (url.protocol === 'chrome-extension:') return url.host === EXTENSION_ID;
    if (url.protocol === 'https:' || url.protocol === 'wss:') {
      if (url.search || url.port) return false;
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
  profileRoot = await mkdtemp(join(temp, 'lace-preview-wallet-'));
  server = await startServer(); origin = `http://127.0.0.1:${server.address().port}`;
  await setStage('start-genuine-extension');
  const allowedHosts = ['127.0.0.1', 'localhost', 'indexer.preview.midnight.network', 'rpc.preview.midnight.network',
    'blockfrost.lw.iog.io', ...new Set([...walletPublicAssetPaths].map(path => new URL(path).hostname))];
  browserContext = await chromium.launchPersistentContext(join(profileRoot, 'profile'), {
    channel: 'chromium', headless: false, viewport: { width: 1440, height: 1000 }, acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      `--host-resolver-rules=MAP * ~NOTFOUND, ${allowedHosts.map(host => `EXCLUDE ${host}`).join(', ')}`],
  });
  browserContext.setDefaultTimeout(45_000); report.chromium = browserContext.browser().version();
  browserContext.on('page', watchPage); browserContext.pages().forEach(watchPage);
  await browserContext.route(/^https?:\/\//, route => {
    if (allowedNetworkUrl(route.request().url(), route.request().method())) return route.continue();
    traffic.blockedRequests++; return route.abort('blockedbyclient');
  });
  await browserContext.routeWebSocket(/.*/, socket => {
    if (allowedNetworkUrl(socket.url(), 'GET') && new URL(socket.url()).protocol === 'wss:') socket.connectToServer();
    else { traffic.blockedWebSockets++; socket.close(); }
  });
  browserContext.on('response', response => {
    const url = response.url();
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
  await wallet.getByTestId('onboarding-create-wallet-toggle-cardano').click();
  await delay(250);
  await wallet.getByTestId('onboarding-create-wallet-toggle-midnight').click();
  await delay(250);
  await wallet.getByTestId('onboarding-create-wallet-finish-button').click();
  await wallet.getByTestId('settings-tab-btn').waitFor({ timeout: 120_000 });
  report.freshWalletCreated = true;
  await setStage('select-preview-and-on-device-wasm');
  await wallet.getByTestId('settings-tab-btn').click();
  await wallet.getByTestId('option-list-item-network').click();
  await wallet.getByTestId('radio-button-testnet').click();
  await wallet.getByTestId('radio-button-midnight-preview').click();
  await wallet.getByTestId('network-selection-sheet-confirm-button').click();
  await wallet.getByTestId('network-selection-sheet').waitFor({ state: 'hidden' });
  await wallet.getByTestId('option-list-item-midnight').click();
  // Exact current selectors are verified from the signed Lace source before CI.
  await wallet.getByTestId('proof-server-in-process-radio').click();
  await wallet.getByTestId('save-configuration-button').click();
  await wallet.getByTestId('midnight-settings-sheet-header').waitFor({ state: 'hidden' });
  await wallet.getByTestId('option-list-item-midnight').click();
  await poll(async () => await wallet.getByTestId('proof-server-in-process-radio').getAttribute('aria-selected') === 'true', 30_000);
  await wallet.getByTestId('side-sheet-close-button').filter({ visible: true }).click();
  await wallet.getByTestId('midnight-settings-sheet-header').waitFor({ state: 'hidden' });
  await wallet.getByTestId('portfolio-tab-btn').click();
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
  report.walletServices = metadata.configuration;
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
  report.finishedAt = new Date().toISOString();
  await save().catch(() => {}); process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await shutdown().catch(() => { process.exitCode = 1; });
  process.stdout.write(JSON.stringify({ status: report.status, stage, acceptedApplicationTransactions: report.operations.filter(op => op.status === 'indexer-accepted').length }) + '\n');
}
