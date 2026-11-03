/** Real Chromium acceptance gate for the generated Compact/WASM application.
 * This never installs a substitute runtime or enables a missing native build.
 * Browser console/error contents and Playwright traces are deliberately not
 * retained: future runtime errors can contain private witness information.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const evidenceDir = join(root, 'artifacts', 'native-browser');
const requireContracts = createRequire(join(root, 'contracts', 'package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
let stage = 'native-build-prerequisites';
let server, browser;
const evidence = {
  executedAt: new Date().toISOString(), node: process.version,
  execution: 'generated-contract-browser-emulator', proofGeneration: false,
  networkSubmission: false, chainInclusionVerified: false, cases: [],
};

function exactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} must contain only approved public fields`);
}

function publicOnly(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!/secret|randomness|proofData|private|selection|witness/i.test(key), 'Public export contains a private field');
    publicOnly(item);
  }
}

async function downloadJson(page, selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const download = await pending;
  const stream = await download.createReadStream();
  assert.ok(stream, 'Public JSON download stream is missing');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  assert.ok(bytes.length < 1_000_000, 'Public JSON download is unexpectedly large');
  const value = JSON.parse(bytes.toString('utf8'));
  publicOnly(value);
  return value;
}

async function waitOperation(page) {
  await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
  assert.equal(await page.locator('#native-status').evaluate(el => el.classList.contains('error')), false,
    'Native UI operation failed');
}

async function checkReceipt(page, text, accepted) {
  await page.locator('#native-receipt-input').fill(text);
  await page.locator('#native-check-receipt').click();
  assert.equal(await page.locator('#native-receipt-check-output').evaluate(el => el.classList.contains('pass')), accepted,
    accepted ? 'Public receipt should match this election' : 'Altered public receipt should be rejected');
  if (accepted) assert.match(await page.locator('#native-receipt-check-output').textContent(), /No chain inclusion or ZK proof was verified/);
}

function changeDigest(value) {
  return (value[0] === '0' ? '1' : '0') + value.slice(1);
}

async function staticServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  const instance = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
      // Serve the same files at root and an arbitrary GitHub project prefix.
      if (pathname.startsWith('/arbitrary-repository-name/')) pathname = pathname.slice('/arbitrary-repository-name'.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const target = resolve(dist, `.${pathname}`);
      if (!target.startsWith(`${dist}${sep}`)) { response.writeHead(403).end(); return; }
      const bytes = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolveListen, reject) => {
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', resolveListen);
  });
  return instance;
}

try {
  await mkdir(evidenceDir, { recursive: true });
  const manifest = await readJson(join(dist, 'native-build.json'));
  assert.equal(manifest.enabled, true, 'A successfully built native implementation is required');
  assert.equal(manifest.bundle, 'native-bundle.mjs');
  assert.equal(manifest.mode, 'local-native-emulator');
  assert.equal(manifest.proofGeneration, false);
  assert.equal(manifest.networkSubmission, false);
  assert.ok(Array.isArray(manifest.assets) && manifest.assets.length > 0, 'Actual WASM assets are required');
  const generated = join(root, 'contracts', 'managed', 'native-election', 'contract', 'index.js');
  assert.ok((await stat(generated)).size > 0, 'Actual generated contract output is required');
  evidence.generatedContractSha256 = hash(await readFile(generated));
  evidence.bundleSha256 = hash(await readFile(join(dist, manifest.bundle)));
  evidence.compiler = manifest.compiler;
  evidence.runtime = manifest.runtime;
  evidence.wasmAssets = [];
  for (const asset of manifest.assets) {
    assert.match(asset, /^native-assets\/[A-Za-z0-9_-]+\.wasm$/);
    const bytes = await readFile(join(dist, asset));
    assert.ok(bytes.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109])), 'WASM asset magic is invalid');
    evidence.wasmAssets.push({ asset, sha256: hash(bytes), bytes: bytes.length });
  }

  stage = 'browser-dependencies';
  const { chromium } = requireContracts('playwright');
  const { default: jsQR } = await import(pathToFileURL(requireContracts.resolve('jsqr')).href);
  const pngjs = requireContracts('pngjs');
  evidence.playwright = requireContracts('playwright/package.json').version;
  stage = 'chromium-launch';
  browser = await chromium.launch({ headless: true });
  evidence.chromium = browser.version();
  server = await staticServer();
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const [pair, prefix, entry] of [
    ['1,2', '/', 'index.html'],
    ['1,3', '/arbitrary-repository-name/', 'index.html'],
    ['2,3', '/arbitrary-repository-name/', 'native.html'],
  ]) {
    stage = `trustees-${pair.replace(',', '-')}:load-native-wasm`;
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1365, height: 1000 } });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(120_000);
      let pageErrors = 0, consoleErrors = 0;
      const requested = new Set(), loadedWasm = new Set();
      page.on('pageerror', () => { pageErrors++; });
      page.on('console', message => { if (message.type() === 'error') consoleErrors++; });
      page.on('request', request => { requested.add(request.url()); });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.endsWith('.wasm') && response.ok()) loadedWasm.add(url.pathname);
      });
      await page.goto(`${origin}${prefix}${entry}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('#native-title').count(), 1, 'The main entry must expose the actual native experience');
      await page.waitForFunction(() => ['ready', 'error', 'unavailable'].includes(document.getElementById('native-availability').dataset.state));
      assert.equal(await page.locator('#native-availability').getAttribute('data-state'), 'ready', 'Native browser initialization must succeed');
      assert.match(await page.locator('#native-availability').textContent(), /no ZK proofs.*no blockchain transactions/i);
      for (const asset of manifest.assets) assert.ok(loadedWasm.has(`${prefix}${asset}`), 'Expected same-origin WASM was not loaded');

      stage = `trustees-${pair.replace(',', '-')}:setup-validation`;
      await page.locator('#native-choice-b').fill('Option A');
      await page.locator('#native-create').click();
      await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
      assert.equal(await page.locator('#native-phase').textContent(), 'Not created');
      assert.match(await page.locator('#native-status').textContent(), /three different choices/);
      await page.locator('#native-choice-b').fill('Option B');
      await page.locator('#native-election-title').fill(`Browser native experiment ${pair}`);
      await page.locator('#native-create').click();
      await waitOperation(page);
      assert.equal(await page.locator('#native-phase').textContent(), 'Voting open');
      assert.match(await page.locator('#native-configuration').textContent(), /^[0-9a-f]{64}$/);

      stage = `trustees-${pair.replace(',', '-')}:five-native-ballots`;
      await page.locator('#native-go-vote').click();
      assert.equal(await page.locator('#native-choices label.selection-card').count(), 3);
      if (pair === '1,2') await page.locator('#native-choice-fieldset').screenshot({ path: join(evidenceDir, 'native-choice-cards.png') });
      // Synthetic acceptance inputs stay in this test process; they are never
      // copied into browser console, screenshots, traces, or result evidence.
      for (const [index, candidate] of [0, 1, 2, 0, 2].entries()) {
        const choice = page.locator(`input[name="native-choice"][value="${candidate}"]`);
        if (index === 0 && pair === '1,2') { await choice.focus(); await choice.press('Space'); }
        else await page.locator(`#native-choices label:has(input[value="${candidate}"])`).click();
        assert.equal(await choice.isChecked(), true, 'Card click or keyboard Space must select the ballot');
        assert.equal(await page.locator('input[name="native-choice"]:checked').count(), 1);
        await page.locator('#native-cast').click();
        await waitOperation(page);
        assert.equal(await page.locator('#native-ballots').textContent(), String(index + 1));
        assert.equal(await page.locator('input[name="native-choice"]:checked').count(), 0, 'Private choice must clear after casting');
      }
      assert.equal(await page.locator('#native-cast').isDisabled(), true, 'No sixth synthetic credential is available');
      assert.equal(await page.locator('#native-ballot-list .ballot-item').count(), 5);

      stage = `trustees-${pair.replace(',', '-')}:rendered-qr-and-json-receipts`;
      const receipt = await downloadJson(page, '#native-save-receipt');
      exactKeys(receipt, ['schema', 'execution', 'network', 'contractAddress', 'electionId', 'configurationDigest',
        'index', 'receipt', 'proofGenerated', 'ledgerInclusionVerified'], 'Receipt');
      assert.equal(receipt.proofGenerated, false);
      assert.equal(receipt.ledgerInclusionVerified, false);
      assert.equal(receipt.network, null);
      assert.equal(receipt.index, 4);
      const png = pngjs.PNG.sync.read(await page.locator('#native-receipt-qr svg').screenshot());
      const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      assert.ok(qr, 'Independent decoder could not read the rendered receipt QR');
      const fields = [receipt.contractAddress, receipt.electionId, receipt.configurationDigest, receipt.receipt];
      const expectedQr = `mbne1:${receipt.index}:${Buffer.concat(fields.map(value => Buffer.from(value, 'hex'))).toString('base64url')}`;
      assert.equal(qr.data, expectedQr, 'Rendered QR does not encode the downloaded public receipt');
      await page.locator('[data-native-nav="check"]').click();
      await checkReceipt(page, qr.data, true);
      await checkReceipt(page, JSON.stringify(receipt), true);
      for (const field of ['contractAddress', 'electionId', 'configurationDigest', 'receipt']) {
        await checkReceipt(page, JSON.stringify({ ...receipt, [field]: changeDigest(receipt[field]) }), false);
      }
      await checkReceipt(page, JSON.stringify({ ...receipt, index: 5 }), false);
      await checkReceipt(page, JSON.stringify({ ...receipt, network: 'preview' }), false);
      await checkReceipt(page, '{"schema":"first","schema":"second"}', false);
      await page.locator('#native-use-receipt').click();
      assert.equal(await page.locator('#native-receipt-input').inputValue(), qr.data);

      stage = `trustees-${pair.replace(',', '-')}:threshold-tally-and-public-checks`;
      await page.locator('[data-native-nav="tally"]').click();
      assert.equal(await page.locator('#native-finalize').isDisabled(), true, 'Tally must remain disabled before close');
      await page.locator('#native-close').click();
      await waitOperation(page);
      assert.equal(await page.locator('#native-phase').textContent(), 'Voting closed');
      assert.equal(await page.locator('input[name="native-trustee"]:checked').count(), 0);
      assert.equal(await page.locator('#native-finalize').isDisabled(), true, 'Choose exactly two trustees before tallying');
      const selectedPair = pair.split(',');
      const firstTrustee = page.locator(`#native-trustee-${selectedPair[0]}`);
      await firstTrustee.focus(); await firstTrustee.press('Space');
      assert.equal(await firstTrustee.isChecked(), true);
      assert.equal(await page.locator('#native-finalize').isDisabled(), true, 'One trustee must not enable tally');
      await page.locator(`label[for="native-trustee-${selectedPair[1]}"]`).click();
      assert.equal(await page.locator('input[name="native-trustee"]:checked').count(), 2);
      const unused = ['1', '2', '3'].find(value => !selectedPair.includes(value));
      assert.equal(await page.locator(`#native-trustee-${unused}`).isDisabled(), true, 'A third selection must be unavailable');
      await page.locator(`label[for="native-trustee-${selectedPair[1]}"]`).click();
      assert.equal(await page.locator(`#native-trustee-${unused}`).isDisabled(), false);
      assert.equal(await page.locator('#native-finalize').isDisabled(), true);
      await page.locator(`label[for="native-trustee-${selectedPair[1]}"]`).click();
      assert.equal(await page.locator('#native-finalize').isDisabled(), false);
      if (pair === '1,3') {
        await page.setViewportSize({ width: 390, height: 844 });
        const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
          content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
        assert.ok(width.content <= width.viewport + 1, 'Trustee cards must fit mobile width');
        await page.locator('#native-trustee-fieldset').screenshot({ path: join(evidenceDir, 'native-trustee-cards-mobile.png') });
        await page.setViewportSize({ width: 1365, height: 1000 });
      }
      await page.locator('#native-finalize').click();
      await waitOperation(page);
      assert.equal(await page.locator('#native-phase').textContent(), 'Finalized');
      assert.deepEqual(await page.locator('#native-result-bars .result-label strong').allTextContents(), ['2', '1', '2']);
      assert.equal(await page.locator('#native-finalize').isDisabled(), true);
      await page.locator('[data-native-nav="check"]').click();
      await page.locator('#native-check-result').click();
      await waitOperation(page);
      assert.match(await page.locator('#native-check-output').textContent(), /Native public consistency checks passed for 5 ballots/);
      const snapshot = await downloadJson(page, '#native-export');
      await waitOperation(page);
      exactKeys(snapshot, ['schema', 'execution', 'network', 'proofGenerated', 'ledgerInclusionVerified', 'warning',
        'contractAddress', 'electionId', 'manifestDigest', 'configurationDigest', 'keysConfigured', 'administrator',
        'opensAt', 'closesAt', 'phase', 'accepted', 'publicKey', 'coefficientKey', 'trusteeKeys',
        'aggregateA', 'aggregateB', 'ballots', 'decryptionShares', 'finalizedTotals', 'manifest'], 'Public snapshot');
      assert.equal(snapshot.execution, 'generated-contract-emulator');
      assert.equal(snapshot.network, null);
      assert.equal(snapshot.proofGenerated, false);
      assert.equal(snapshot.ledgerInclusionVerified, false);
      assert.equal(snapshot.accepted, 5);
      assert.deepEqual(snapshot.finalizedTotals, [2, 1, 2]);
      assert.deepEqual(snapshot.decryptionShares.map(share => share.index), pair.split(',').map(Number));
      assert.equal(snapshot.manifestDigest, hash(Buffer.from(JSON.stringify(snapshot.manifest))));
      assert.equal(snapshot.configurationDigest, receipt.configurationDigest);
      exactKeys(snapshot.manifest, ['schema', 'execution', 'electionId', 'title', 'candidates',
        'threshold', 'capacity', 'syntheticVoters', 'opensAt', 'closesAt'], 'Public metadata');
      for (const ballot of snapshot.ballots) exactKeys(ballot, ['index', 'a', 'b', 'nullifier', 'receipt'], 'Public ballot');
      for (const share of snapshot.decryptionShares) exactKeys(share, ['index', 'values'], 'Public trustee contribution');
      await writeFile(join(evidenceDir, `public-trustees-${pair.replace(',', '-')}.json`), JSON.stringify(snapshot, null, 2) + '\n');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(evidenceDir, `public-checks-trustees-${pair.replace(',', '-')}.png`), fullPage: true });

      let mobileViewportChecked = false;
      if (pair === '1,3') {
        stage = 'main-entry:mobile-layout';
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
        const layout = await page.evaluate(() => ({ width: document.documentElement.clientWidth,
          contentWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
        assert.equal(layout.width, 390);
        assert.ok(layout.contentWidth <= layout.width + 1, 'Native main page must not overflow horizontally at 390px');
        await page.screenshot({ path: join(evidenceDir, 'public-checks-mobile-390.png'), fullPage: true });
        mobileViewportChecked = true;
        await page.setViewportSize({ width: 1365, height: 1000 });
      }

      stage = `trustees-${pair.replace(',', '-')}:reset-and-context-binding`;
      await page.locator('#native-reset').click();
      assert.equal(await page.locator('#native-phase').textContent(), 'Not created');
      assert.equal(await page.locator('#native-ballots').textContent(), '0');
      assert.equal(await page.locator('#native-receipt-input').inputValue(), '');
      assert.equal(await page.locator('#native-receipt-qr svg').count(), 0);
      assert.equal(await page.locator('input[name="native-trustee"]:checked').count(), 0, 'Reset must clear trustee selection');
      await page.locator('#native-create').click();
      await waitOperation(page);
      await page.locator('[data-native-nav="check"]').click();
      await checkReceipt(page, qr.data, false);
      assert.equal(await page.evaluate(() => localStorage.length), 0, 'Demo private state must not persist in localStorage');
      assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'Demo private state must not persist in sessionStorage');
      assert.equal(pageErrors, 0, 'Native page produced an uncaught browser error');
      assert.equal(consoleErrors, 0, 'Native page produced a console error');
      for (const urlText of requested) {
        const url = new URL(urlText);
        assert.equal(url.origin, origin, 'Native emulator must not send data to another origin');
      }
      assert.ok(requested.has(`${origin}${prefix}${manifest.bundle}`), 'Actual generated browser bundle must execute');
      evidence.cases.push({ trustees: pair.split(',').map(Number), prefix, entry, passed: true, accepted: 5,
        clickableCardsChecked: true, keyboardSelectionChecked: true, exactTwoTrusteesChecked: true,
        renderedQrDecoded: true, receiptContextRejections: true, reset: true, wasmLoaded: loadedWasm.size, mobileViewportChecked });
      console.log(JSON.stringify({ stage: `trustees-${pair.replace(',', '-')}`, passed: true }));
    } finally { await context.close(); }
  }

  for (const failure of ['disabled-build', 'missing-wasm']) {
    stage = `fail-closed:${failure}`;
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      if (failure === 'disabled-build') {
        await context.route('**/native-build.json', route => route.fulfill({ contentType: 'application/json', body: '{"enabled":false}' }));
      } else {
        await context.route('**/native-assets/*.wasm', route => route.abort('failed'));
      }
      await page.goto(`${origin}/arbitrary-repository-name/index.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => ['error', 'unavailable'].includes(document.getElementById('native-availability').dataset.state));
      assert.equal(await page.locator('#native-availability').getAttribute('data-state'), failure === 'disabled-build' ? 'unavailable' : 'error');
      assert.equal(await page.locator('[data-native-control]:enabled').count(), 0, 'Missing native prerequisites must disable every control');
      assert.equal(await page.locator('#native-ballots').textContent(), '0');
      evidence.cases.push({ failure, passed: true, controlsDisabled: true });
      console.log(JSON.stringify({ stage, passed: true }));
    } finally { await context.close(); }
  }
  evidence.passed = true;
  console.log(JSON.stringify({ nativeBrowserAcceptance: 'passed', cases: evidence.cases.length,
    proofGeneration: false, networkSubmission: false }));
} catch (error) {
  evidence.passed = false;
  evidence.failure = { stage, kind: error?.name ?? 'Error' };
  // Do not persist arbitrary runtime exception payloads or private witnesses.
  console.error(JSON.stringify({ nativeBrowserAcceptance: 'failed', ...evidence.failure,
    note: 'No native success is claimed. Diagnose this named stage without publishing witness data.' }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
}
