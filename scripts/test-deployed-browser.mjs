/** Acceptance against the explicitly selected, already deployed GitHub Pages site.
 * No local server, substituted responses, wallet, proof generation or submission.
 * Only public outputs and counters are saved; no browser traces or raw errors.
 * Run only after deployment: node scripts/test-deployed-browser.mjs <exact URL>
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const approvedUrl = 'https://ibkr-bouncybot.github.io/Midnight-BallotLab/';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDirectory = join(root, 'artifacts', 'deployed-browser');
const requireContracts = createRequire(join(root, 'contracts', 'package.json'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = {
  executedAt: new Date().toISOString(), node: process.version,
  execution: 'live-github-pages-generated-contract-and-sdk-browser',
  walletConnected: false, proofGeneration: false, networkSubmission: false,
  chainInclusionVerified: false, httpAssets: [], cases: [],
};
let stage = 'explicit-deployment-url', browser;

function exactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Export fields must be explicitly public');
}

function publicOnly(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!/secret|randomness|proofData|private|selection|witness/i.test(key), 'Private field in public export');
    publicOnly(item);
  }
}

function publicAssetUrl(path) {
  assert.ok(typeof path === 'string' && !path.startsWith('/') && !path.includes('..'));
  assert.match(path, /^[A-Za-z0-9_./-]*$/);
  const url = new URL(path, approvedUrl);
  assert.ok(url.href.startsWith(approvedUrl), 'Asset must remain within selected Pages project');
  return url.href;
}

async function fetchAsset(path, { kind, expectedBytes, expectedHash, retain = false } = {}) {
  stage = `live-http:${path || 'index'}`;
  const response = await fetch(publicAssetUrl(path), {
    redirect: 'error', signal: AbortSignal.timeout(120_000), cache: 'no-store',
  });
  assert.equal(response.status, 200, 'Live asset must be served successfully');
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const mimeTypes = {
    html: ['text/html'], json: ['application/json'],
    javascript: ['application/javascript', 'text/javascript'], wasm: ['application/wasm'],
  };
  if (mimeTypes[kind]) assert.ok(mimeTypes[kind].includes(mime), 'Unexpected live asset MIME type');
  else assert.ok(mime && mime !== 'text/html', 'A binary asset must not resolve to a fallback HTML page');
  assert.ok(response.body, 'Live asset has no response body');
  const digest = createHash('sha256'), chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    assert.ok(bytes <= (expectedBytes ?? 128_000_000), 'Live asset exceeds expected size limit');
    digest.update(chunk);
    if (retain || kind === 'wasm' && chunks.length === 0) chunks.push(Buffer.from(chunk));
  }
  assert.ok(bytes > 0, 'Live asset is empty');
  const actualHash = digest.digest('hex');
  if (expectedBytes !== undefined) assert.equal(bytes, expectedBytes, 'Live circuit asset length mismatch');
  if (expectedHash !== undefined) assert.equal(actualHash, expectedHash, 'Live asset digest mismatch');
  if (kind === 'wasm') assert.ok(chunks[0].subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'Invalid WASM magic');
  const headerNames = ['content-type', 'content-length', 'content-encoding', 'cache-control', 'etag', 'last-modified',
    'x-content-type-options', 'content-security-policy', 'strict-transport-security', 'x-github-request-id'];
  const headers = Object.fromEntries(headerNames.map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
  evidence.httpAssets.push({ path: path || 'index (project URL)', status: response.status, bytes, sha256: actualHash, headers });
  return retain ? Buffer.concat(chunks) : undefined;
}

async function downloadJson(page, selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const stream = await (await pending).createReadStream();
  assert.ok(stream, 'Public download stream is missing');
  const chunks = [];
  let length = 0;
  for await (const chunk of stream) {
    length += chunk.length;
    assert.ok(length < 1_000_000, 'Public export is unexpectedly large');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  publicOnly(value);
  return value;
}

async function nativeOperation(page) {
  await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
  assert.equal(await page.locator('#native-status').evaluate(el => el.classList.contains('error')), false);
}

function observe(page) {
  const counters = { pageErrors: 0, consoleErrors: 0, incidentalFaviconErrors: 0, offSiteRequests: 0 };
  const requests = new Set(), wasmLoaded = new Set();
  page.on('pageerror', () => { counters.pageErrors++; });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // Browsers may request the account-level favicon outside the project path.
    // Its absence does not make the deployed application fail; record it separately.
    if (message.location().url === new URL('/favicon.ico', approvedUrl).href) counters.incidentalFaviconErrors++;
    else counters.consoleErrors++;
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (['data:', 'blob:'].includes(url.protocol)) return;
    requests.add(url.href);
    if (!url.href.startsWith(approvedUrl) && url.href !== new URL('/favicon.ico', approvedUrl).href) counters.offSiteRequests++;
  });
  page.on('response', response => {
    if (response.ok() && new URL(response.url()).pathname.endsWith('.wasm')) wasmLoaded.add(response.url());
  });
  return { counters, requests, wasmLoaded };
}

function assertBrowserClean(observed) {
  assert.equal(observed.counters.pageErrors, 0, 'Uncaught browser runtime error');
  assert.equal(observed.counters.consoleErrors, 0, 'Unexpected browser console error');
  assert.equal(observed.counters.offSiteRequests, 0, 'Unexpected request outside selected Pages project');
}

async function checkReceipt(page, value, accepted) {
  await page.locator('#native-receipt-input').fill(value);
  await page.locator('#native-check-receipt').click();
  await nativeOperation(page);
  assert.equal(await page.locator('#native-receipt-check-output').evaluate(el => el.classList.contains('pass')), accepted);
  if (accepted) assert.match(await page.locator('#native-receipt-check-output').textContent(), /does not prove voter identity, fairness or blockchain confirmation/);
}

try {
  assert.equal(process.argv.length, 3, 'Exactly one explicit deployed URL argument is required');
  assert.equal(process.argv[2], approvedUrl, 'Only the user-selected HTTPS GitHub Pages URL is authorized');
  evidence.url = approvedUrl;
  await mkdir(evidenceDirectory, { recursive: true });
  await fetchAsset('', { kind: 'html' });
  await fetchAsset('network.html', { kind: 'html' });
  const native = JSON.parse((await fetchAsset('native-build.json', { kind: 'json', retain: true })).toString('utf8'));
  const network = JSON.parse((await fetchAsset('network-build.json', { kind: 'json', retain: true })).toString('utf8'));
  stage = 'live-manifest-prerequisites';
  assert.equal(native.enabled, true); assert.equal(native.bundle, 'native-bundle.mjs');
  assert.equal(native.mode, 'local-native-emulator');
  assert.equal(native.proofGeneration, false); assert.equal(native.networkSubmission, false);
  assert.equal(native.compiler, '0.31.1'); assert.equal(native.runtime, '0.16.0');
  assert.equal(native.assets.length, 1);
  assert.equal(network.enabled, true); assert.equal(network.bundle, 'network-bundle.mjs');
  assert.equal(network.mode, 'development-network-client');
  assert.equal(network.compiler, native.compiler); assert.equal(network.runtime, native.runtime);
  assert.equal(network.sdk, '4.1.1'); assert.equal(network.wasmAssets.length, 2);
  assert.equal(network.circuitAssets.length, 21);
  evidence.versions = { compiler: native.compiler, runtime: native.runtime, sdk: network.sdk };
  await fetchAsset(native.bundle, { kind: 'javascript' });
  await fetchAsset(network.bundle, { kind: 'javascript' });
  for (const [paths, prefix] of [[native.assets, 'native-assets'], [network.wasmAssets, 'network-assets']]) {
    assert.equal(new Set(paths).size, paths.length);
    for (const path of paths) {
      assert.match(path, new RegExp(`^${prefix}/[A-Za-z0-9_]+-([a-f0-9]{64})\\.wasm$`));
      await fetchAsset(path, { kind: 'wasm', expectedHash: /-([a-f0-9]{64})\.wasm$/.exec(path)[1] });
    }
  }
  const expectedCircuitPaths = ['configureKeys', 'enroll', 'openVoting', 'castBallot', 'closeVoting', 'submitDecryption', 'finalize']
    .flatMap(name => [`native-contract/keys/${name}.prover`, `native-contract/keys/${name}.verifier`, `native-contract/zkir/${name}.bzkir`]);
  assert.deepEqual(network.circuitAssets.map(asset => asset.path).sort(), expectedCircuitPaths.sort());
  for (const asset of network.circuitAssets) {
    assert.ok(Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && asset.bytes < 128_000_000);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    await fetchAsset(asset.path, { kind: 'binary', expectedBytes: asset.bytes, expectedHash: asset.sha256 });
  }
  evidence.cases.push({ case: 'live-http-manifests-bundles-wasm-and-circuit-assets', status: 'passed',
    wasmAssets: 3, circuitAssets: 21, integrityScope: 'served manifests and content-addressed WASM; bundle digests recorded' });
  console.log(JSON.stringify({ stage: 'live-http-assets', status: 'passed', assets: evidence.httpAssets.length }));

  stage = 'real-browser-launch';
  const { chromium } = requireContracts('playwright');
  const { default: jsQR } = await import(pathToFileURL(requireContracts.resolve('jsqr')).href);
  const { PNG } = requireContracts('pngjs');
  evidence.playwright = requireContracts('playwright/package.json').version;
  browser = await chromium.launch({ headless: true }); evidence.chromium = browser.version();
  const nativeContext = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', viewport: { width: 1365, height: 1000 } });
  try {
    const page = await nativeContext.newPage(); page.setDefaultTimeout(120_000);
    const observed = observe(page);
    stage = 'live-native:initialization';
    await page.goto(approvedUrl, { waitUntil: 'networkidle' });
    assert.equal(page.url(), approvedUrl);
    assert.equal(await page.locator('#native-title').count(), 1);
    await page.waitForFunction(() => ['ready', 'error', 'unavailable'].includes(document.getElementById('native-availability').dataset.state));
    assert.equal(await page.locator('#native-availability').getAttribute('data-state'), 'ready');
    assert.match(await page.locator('#native-availability').textContent(), /no proofs.*no blockchain transactions/i);
    assert.equal(await page.locator('.version').textContent(), 'v0.6.1');
    for (const asset of native.assets) assert.ok(observed.wasmLoaded.has(publicAssetUrl(asset)));

    stage = 'live-native:setup';
    await page.locator('#native-election-title').fill('Hosted native acceptance experiment');
    await page.locator('#native-create').click(); await nativeOperation(page);
    assert.equal(await page.locator('#native-phase').textContent(), 'Voting open');
    assert.match(await page.locator('#native-configuration').textContent(), /^[0-9a-f]{64}$/);
    await page.locator('#native-go-vote').click();
    stage = 'live-native:five-ballots';
    // Synthetic choices exist only during this local runtime test and are never
    // retained in evidence, logs, screenshots, browser traces or public exports.
    for (const [index, candidate] of [0, 1, 2, 0, 2].entries()) {
      await page.locator('#native-voter').selectOption(String(index));
      await page.locator(`#native-choices label:has(input[value="${candidate}"])`).click();
      assert.equal(await page.locator(`input[name="native-choice"][value="${candidate}"]`).isChecked(), true);
      await page.locator('#native-cast').click(); await nativeOperation(page);
      assert.equal(await page.locator('#native-ballots').textContent(), String(index + 1));
      assert.equal(await page.locator('input[name="native-choice"]:checked').count(), 0);
    }
    assert.equal(await page.locator('#native-cast').isDisabled(), true);
    assert.equal(await page.locator('#native-ballot-list .ballot-item').count(), 5);
    stage = 'live-native:rendered-qr-and-public-receipt';
    const receipt = await downloadJson(page, '#native-save-receipt');
    exactKeys(receipt, ['schema', 'execution', 'network', 'contractAddress', 'electionId', 'configurationDigest',
      'index', 'receipt', 'proofGenerated', 'ledgerInclusionVerified']);
    assert.equal(receipt.index, 4); assert.equal(receipt.network, null);
    assert.equal(receipt.proofGenerated, false); assert.equal(receipt.ledgerInclusionVerified, false);
    const png = PNG.sync.read(await page.locator('#native-receipt-qr svg').screenshot());
    const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    assert.ok(qr, 'Rendered public QR must decode independently');
    const qrBytes = Buffer.concat([receipt.contractAddress, receipt.electionId, receipt.configurationDigest, receipt.receipt]
      .map(value => { assert.match(value, /^[0-9a-f]{64}$/); return Buffer.from(value, 'hex'); }));
    assert.equal(qr.data, `mbne1:${receipt.index}:${qrBytes.toString('base64url')}`);
    await page.locator('[data-native-nav="check"]').click();
    await checkReceipt(page, qr.data, true);
    await checkReceipt(page, JSON.stringify(receipt), true);
    const changed = (receipt.receipt[0] === '0' ? '1' : '0') + receipt.receipt.slice(1);
    await checkReceipt(page, JSON.stringify({ ...receipt, receipt: changed }), false);
    await checkReceipt(page, JSON.stringify({ ...receipt, network: 'preview' }), false);
    await checkReceipt(page, qr.data, true);

    stage = 'live-native:threshold-tally-and-public-checks';
    await page.locator('[data-native-nav="tally"]').click();
    assert.equal(await page.locator('#native-finalize').isDisabled(), true);
    await page.locator('#native-close').click(); await nativeOperation(page);
    assert.equal(await page.locator('#native-phase').textContent(), 'Voting closed');
    assert.equal(await page.locator('#native-finalize').isDisabled(), true);
    await page.locator('label[for="native-trustee-1"]').click();
    assert.equal(await page.locator('#native-finalize').isDisabled(), true);
    await page.locator('label[for="native-trustee-3"]').click();
    assert.equal(await page.locator('input[name="native-trustee"]:checked').count(), 2);
    assert.equal(await page.locator('#native-trustee-2').isDisabled(), true);
    await page.locator('#native-finalize').click(); await nativeOperation(page);
    assert.equal(await page.locator('#native-phase').textContent(), 'Results ready');
    assert.deepEqual(await page.locator('#native-result-bars .result-label strong').allTextContents(), ['2', '1', '2']);
    assert.equal(await page.locator('#native-finalize').isDisabled(), true);
    await page.locator('[data-native-nav="check"]').click();
    await page.locator('#native-check-result').click(); await nativeOperation(page);
    assert.match(await page.locator('#native-check-output').textContent(), /Election checks passed for 5 ballots/);
    const snapshot = await downloadJson(page, '#native-export'); await nativeOperation(page);
    exactKeys(snapshot, ['schema', 'execution', 'network', 'proofGenerated', 'ledgerInclusionVerified', 'warning',
      'contractAddress', 'electionId', 'manifestDigest', 'configurationDigest', 'keysConfigured', 'administrator',
      'opensAt', 'closesAt', 'candidateCount', 'phase', 'accepted', 'publicKey', 'coefficientKey', 'trusteeKeys',
      'aggregateA', 'aggregateB', 'ballots', 'decryptionShares', 'finalizedTotals', 'manifest']);
    exactKeys(snapshot.manifest, ['schema', 'execution', 'electionId', 'title', 'candidates', 'threshold', 'capacity',
      'syntheticVoters', 'timingMode', 'durationSeconds', 'opensAt', 'closesAt']);
    for (const ballot of snapshot.ballots) exactKeys(ballot, ['index', 'a', 'b', 'nullifier', 'receipt']);
    for (const share of snapshot.decryptionShares) exactKeys(share, ['index', 'values']);
    assert.equal(snapshot.execution, 'generated-contract-emulator'); assert.equal(snapshot.network, null);
    assert.equal(snapshot.proofGenerated, false); assert.equal(snapshot.ledgerInclusionVerified, false);
    assert.equal(snapshot.accepted, 5); assert.equal(snapshot.candidateCount, 3);
    assert.deepEqual(snapshot.finalizedTotals, [2, 1, 2, 0, 0]);
    assert.deepEqual(snapshot.decryptionShares.map(share => share.index), [1, 3]);
    assert.equal(snapshot.configurationDigest, receipt.configurationDigest);
    assert.equal(snapshot.manifestDigest, sha256(Buffer.from(JSON.stringify(snapshot.manifest))));
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert.equal(await page.evaluate(() => sessionStorage.length), 0);
    assert.ok(observed.requests.has(publicAssetUrl(native.bundle)), 'Actual generated browser bundle must execute');
    assertBrowserClean(observed);
    await writeFile(join(evidenceDirectory, 'public-native-snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(evidenceDirectory, 'public-native-checks.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth,
      contentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
    assert.equal(layout.width, 390); assert.ok(layout.contentWidth <= layout.width + 1);
    await page.screenshot({ path: join(evidenceDirectory, 'public-native-mobile-390.png'), fullPage: true });
    evidence.cases.push({ case: 'live-native-five-ballot-threshold-flow', status: 'passed', accepted: 5,
      trusteePair: [1, 3], finalizedTotals: [2, 1, 2], renderedQrDecoded: true, receiptRoundTrips: true,
      alteredReceiptRejected: true, publicExportAllowlist: true, mobileViewportWidth: 390, ...observed.counters });
    console.log(JSON.stringify({ stage: 'live-native-flow', status: 'passed' }));
  } finally { await nativeContext.close(); }

  stage = 'live-network:real-sdk-initialization';
  const networkContext = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1365, height: 1000 } });
  try {
    const page = await networkContext.newPage(); page.setDefaultTimeout(120_000);
    const observed = observe(page);
    await page.goto(publicAssetUrl('network.html'), { waitUntil: 'networkidle' });
    await page.waitForFunction(() => ['ready', 'unavailable'].includes(document.getElementById('network-availability').dataset.state));
    assert.equal(await page.locator('#network-availability').getAttribute('data-state'), 'ready');
    assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined');
    assert.match(await page.locator('#network-wallet-note').textContent(), /No compatible wallet detected/);
    assert.match(await page.locator('#network-availability').textContent(), /No proof or transaction has been created yet/);
    assert.equal(await page.locator('#network-id').inputValue(), '');
    assert.equal(await page.locator('#network-id option[value="mainnet"]').count(), 0);
    for (const name of ['network-choice', 'network-trustee', 'network-pair']) {
      assert.equal(await page.locator(`input[name="${name}"]`).count(), name === 'network-choice' ? 5 : 3);
      assert.equal(await page.locator(`input[name="${name}"]:checked`).count(), 0);
      for (const input of await page.locator(`input[name="${name}"]`).all()) assert.equal(await input.isDisabled(), true);
    }
    for (const asset of network.wasmAssets) assert.ok(observed.wasmLoaded.has(publicAssetUrl(asset)));
    const actionSelectors = ['#network-deploy', '#network-join', '#network-cast', '#network-finalize'];
    for (const selector of actionSelectors) assert.equal(await page.locator(selector).isDisabled(), true);
    stage = 'live-network:no-wallet-fails-closed';
    await page.locator('#network-id').selectOption('preview');
    await page.locator('#network-indexer').fill('https://indexer.example.invalid/graphql');
    await page.locator('#network-indexer-ws').fill('wss://indexer.example.invalid/graphql/ws');
    // Disposable form fixture, not a wallet credential. Clear before screenshots.
    await page.locator('#network-password').fill('Browser-Test-Q7#M2!');
    await page.locator('#network-connect-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('network-status').textContent.includes('could not finish'));
    await page.locator('#network-password').fill('');
    for (const selector of actionSelectors) assert.equal(await page.locator(selector).isDisabled(), true);
    assert.equal(await page.locator('#network-events').textContent(), '');
    assertBrowserClean(observed);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(evidenceDirectory, 'network-no-wallet.png'), fullPage: false });
    evidence.cases.push({ case: 'live-network-real-sdk-no-wallet-failure', status: 'passed',
      wasmLoaded: observed.wasmLoaded.size, actionsDisabled: true, noTransactionEvents: true, ...observed.counters });
    console.log(JSON.stringify({ stage: 'live-network-no-wallet', status: 'passed' }));
  } finally { await networkContext.close(); }
  evidence.status = 'passed';
  console.log(JSON.stringify({ status: 'passed', cases: evidence.cases.length, url: approvedUrl,
    evidence: 'artifacts/deployed-browser/evidence.json', proofGeneration: false, networkSubmission: false }));
} catch {
  evidence.status = 'failed'; evidence.failedStage = stage;
  console.error(JSON.stringify({ status: 'failed', stage, evidence: 'artifacts/deployed-browser/evidence.json' }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}
