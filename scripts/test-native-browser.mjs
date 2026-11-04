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
  if (selector === '#native-save-receipt') assert.equal(download.suggestedFilename(), 'midnight-ballot-receipt.json');
  if (selector === '#native-export') assert.equal(download.suggestedFilename(), 'midnight-election-record.json');
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
  await checkLoadedReceipt(page, accepted);
}

async function checkLoadedReceipt(page, accepted) {
  await page.locator('#native-check-receipt').click();
  await waitOperation(page);
  assert.equal(await page.locator('#native-receipt-check-output').evaluate(el => el.classList.contains('pass')), accepted,
    accepted ? 'Public receipt should match this election' : 'Altered public receipt should be rejected');
  if (accepted) assert.match(await page.locator('#native-receipt-check-output').textContent(), /does not prove voter identity, fairness or blockchain confirmation/);
}

async function uploadReceipt(page, text, name = 'saved-receipt.json', valid = true) {
  await page.locator('#native-receipt-file').setInputFiles({ name,
    mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(text) });
  await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
  assert.equal(await page.locator('#native-status').evaluate(element => element.classList.contains('error')), !valid);
  assert.equal(await page.locator('#native-receipt-input').inputValue(), valid ? text.trim() : '');
  if (valid) assert.equal(await page.locator('#native-receipt-check-output').textContent(), '', 'Uploading a receipt must not mark it verified');
  else assert.equal(await page.locator('#native-receipt-check-output').evaluate(element => element.classList.contains('pass')), false);
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
  const networkManifest = await readJson(join(dist, 'network-build.json'));
  assert.equal(networkManifest.enabled, true, 'The testnet landing destination requires a real network build');
  assert.equal(networkManifest.bundle, 'network-bundle.mjs');
  assert.equal(networkManifest.wasmAssets.length, 2);
  evidence.networkBundleSha256 = hash(await readFile(join(dist, networkManifest.bundle)));
  evidence.landingHtmlSha256 = hash(await readFile(join(dist, 'index.html')));
  evidence.landingCssSha256 = hash(await readFile(join(dist, 'landing.css')));

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

  for (const prefix of ['/', '/arbitrary-repository-name/']) {
    stage = `landing:${prefix}:navigation`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const destinations = [];
    try {
      for (const destination of [
        { demo: 'browser', file: 'native.html', availability: 'native-availability', assets: manifest.assets },
        { demo: 'testnet', file: 'network.html', availability: 'network-availability', assets: networkManifest.wasmAssets },
      ]) {
        const page = await context.newPage(); page.setDefaultTimeout(120_000);
        const requested = new Set(), loadedWasm = new Set();
        let pageErrors = 0, consoleErrors = 0, sockets = 0;
        page.on('pageerror', () => { pageErrors++; });
        page.on('console', message => { if (message.type() === 'error') consoleErrors++; });
        page.on('request', request => { requested.add(request.url()); });
        page.on('websocket', () => { sockets++; });
        page.on('response', response => {
          if (response.ok() && new URL(response.url()).pathname.endsWith('.wasm')) loadedWasm.add(new URL(response.url()).pathname);
        });
        await page.goto(`${origin}${prefix}index.html`, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('#landing-title').count(), 1);
        assert.equal(await page.locator('#demo-options a[data-demo]').count(), 2);
        for (const [demo, file] of [['browser', 'native.html'], ['testnet', 'network.html']]) {
          const card = page.locator(`a[data-demo="${demo}"]`);
          assert.equal(await card.getAttribute('href'), `./${file}`);
          assert.equal(await card.isVisible(), true);
          assert.ok([null, '_self'].includes(await card.getAttribute('target')));
        }
        assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined');
        assert.equal(await page.locator('#native-availability, #network-availability').count(), 0);
        assert.equal(loadedWasm.size, 0); assert.equal(sockets, 0);
        for (const request of requested) {
          const url = new URL(request);
          assert.equal(url.origin, origin, 'Landing must not contact external services');
          assert.doesNotMatch(url.pathname, /(?:native|network)-(?:bundle|loader|assets|build)|\.wasm$/,
            'Choosing an experience must precede loading its cryptographic runtime');
        }
        const scripts = await page.locator('script[src]').evaluateAll(elements => elements.map(element => element.getAttribute('src')));
        assert.deepEqual(scripts, ['./support.mjs'], 'Only the existing local support clipboard handler belongs on the landing page');
        const font = await page.evaluate(async () => { await document.fonts.ready; return {
          loaded: document.fonts.check('16px Outfit'), family: getComputedStyle(document.body).fontFamily }; });
        assert.equal(font.loaded, true); assert.match(font.family, /Outfit/);
        if (prefix === '/' && destination.demo === 'browser') {
          for (const viewport of [1440, 390, 320]) {
            await page.setViewportSize({ width: viewport, height: viewport === 1440 ? 1000 : 844 });
            const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
              content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
            assert.equal(layout.viewport, viewport); assert.ok(layout.content <= viewport + 1);
            await page.screenshot({ path: join(evidenceDir, `landing-empty-${viewport}.png`), fullPage: true, animations: 'disabled' });
          }
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
        stage = `landing:${prefix}:${destination.demo}:actual-destination`;
        await Promise.all([
          page.waitForURL(`${origin}${prefix}${destination.file}`),
          page.locator(`a[data-demo="${destination.demo}"]`).click(),
        ]);
        await page.waitForFunction(id => ['ready', 'error', 'unavailable'].includes(document.getElementById(id)?.dataset.state), destination.availability);
        assert.equal(await page.locator(`#${destination.availability}`).getAttribute('data-state'), 'ready');
        for (const asset of destination.assets) assert.ok(loadedWasm.has(`${prefix}${asset}`), 'Selected experience must load its actual same-origin WASM');
        if (destination.demo === 'browser') {
          assert.equal(await page.locator('#native-phase').textContent(), 'Not created');
          assert.equal(await page.locator('#native-create').isDisabled(), false);
        } else {
          assert.equal(await page.locator('#network-id').inputValue(), 'preview');
          assert.equal(await page.locator('#network-deploy').isDisabled(), true);
          assert.equal(await page.locator('#network-events').textContent(), '');
        }
        for (const request of requested) assert.equal(new URL(request).origin, origin, 'Opening either experience must not contact a public service');
        assert.equal(pageErrors, 0); assert.equal(consoleErrors, 0); assert.equal(sockets, 0);
        destinations.push({ demo: destination.demo, path: `${prefix}${destination.file}`, actualReady: true,
          wasmLoaded: loadedWasm.size, walletConnected: false, publicRequests: 0 });
        await page.close();
      }
      evidence.cases.push({ case: 'landing-navigation', prefix, passed: true, destinations,
        runtimeLoadedBeforeChoice: false, walletConnected: false, publicRequests: 0,
        ...(prefix === '/' ? { responsiveWidths: [1440, 390, 320], screenshotsWithEmptyStateOnly: true } : {}) });
      console.log(JSON.stringify({ stage: `landing:${prefix}`, passed: true }));
    } finally { await context.close(); }
  }

  for (const { pair, prefix, entry, candidateCount, voterCount, selections, voterOrder, totals } of [
    { pair: '1,2', prefix: '/', entry: 'index.html', candidateCount: 3, voterCount: 5,
      selections: [0, 1, 2, 0, 2], voterOrder: [0, 1, 2, 3, 4], totals: [2, 1, 2] },
    { pair: '1,3', prefix: '/arbitrary-repository-name/', entry: 'index.html', candidateCount: 2, voterCount: 3,
      selections: [1, 0, 1], voterOrder: [2, 0, 1], totals: [1, 2] },
    { pair: '2,3', prefix: '/arbitrary-repository-name/', entry: 'native.html', candidateCount: 5, voterCount: 7,
      selections: [4, 0, 3, 1, 4, 2, 0], voterOrder: [6, 1, 4, 0, 5, 2, 3], totals: [2, 1, 1, 1, 2] },
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
      if (entry === 'index.html') {
        await Promise.all([page.waitForURL(`${origin}${prefix}native.html`), page.locator('a[data-demo="browser"]').click()]);
      }
      assert.equal(await page.locator('#native-title').count(), 1, 'The browser-demo destination must expose the actual native experience');
      await page.waitForFunction(() => ['ready', 'error', 'unavailable'].includes(document.getElementById('native-availability').dataset.state));
      assert.equal(await page.locator('#native-availability').getAttribute('data-state'), 'ready', 'Native browser initialization must succeed');
      assert.match(await page.locator('#native-availability').textContent(), /no proofs.*no blockchain transactions/i);
      assert.equal(await page.locator('.version').textContent(), 'v0.6.1');
      const font = await page.evaluate(async () => { await document.fonts.ready; return {
        loaded: document.fonts.check('16px Outfit'), family: getComputedStyle(document.body).fontFamily }; });
      assert.equal(font.loaded, true, 'Self-hosted Outfit must load'); assert.match(font.family, /Outfit/);
      for (const asset of manifest.assets) assert.ok(loadedWasm.has(`${prefix}${asset}`), 'Expected same-origin WASM was not loaded');

      stage = `trustees-${pair.replace(',', '-')}:setup-validation`;
      assert.deepEqual(await page.locator('#native-candidate-count option').evaluateAll(options => options.map(option => option.value)), ['2', '3', '4', '5']);
      for (const invalidCount of ['0', '1025', '1.5']) {
        await page.locator('#native-voter-count').fill(invalidCount);
        assert.equal(await page.locator('#native-voter-count').evaluate(input => input.checkValidity()), false);
        await page.locator('#native-create').click();
        assert.equal(await page.locator('#native-phase').textContent(), 'Not created');
      }
      for (const validCount of ['1', '1024']) {
        await page.locator('#native-voter-count').fill(validCount);
        assert.equal(await page.locator('#native-voter-count').evaluate(input => input.checkValidity()), true);
      }
      await page.locator('#native-voter-count').fill(String(voterCount));
      await page.locator('#native-candidate-count').selectOption(String(candidateCount));
      await page.locator('#native-choice-b').fill('Option A');
      await page.locator('#native-create').click();
      await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
      assert.equal(await page.locator('#native-phase').textContent(), 'Not created');
      assert.match(await page.locator('#native-status').textContent(), /different choices/);
      await page.locator('#native-choice-b').fill('Option B');
      await page.locator('#native-election-title').fill(`Browser native experiment ${pair}`);
      await page.locator('#native-create').click();
      await waitOperation(page);
      assert.equal(await page.locator('#native-phase').textContent(), 'Voting open');
      assert.match(await page.locator('#native-configuration').textContent(), /^[0-9a-f]{64}$/);

      stage = `trustees-${pair.replace(',', '-')}:configured-native-ballots`;
      await page.locator('#native-go-vote').click();
      assert.equal(await page.locator('#native-choices label.selection-card').count(), candidateCount);
      assert.equal(await page.locator('#native-voter option').count(), voterCount + 1);
      assert.equal(await page.locator('#native-cast').isDisabled(), true, 'A voter must be selected explicitly');
      if (pair === '1,2') {
        await page.locator('#native-voter').selectOption('0');
        await page.locator('#native-choice-fieldset').screenshot({ path: join(evidenceDir, 'native-choice-cards.png') });
      }
      const publicReceipts = [];
      // Synthetic acceptance inputs stay in this test process; they are never
      // copied into browser console, screenshots, traces, or result evidence.
      for (const [index, candidate] of selections.entries()) {
        await page.locator('#native-voter').selectOption(String(voterOrder[index]));
        const choice = page.locator(`input[name="native-choice"][value="${candidate}"]`);
        if (index === 0 && pair === '1,2') { await choice.focus(); await choice.press('Space'); }
        else await page.locator(`#native-choices label:has(input[value="${candidate}"])`).click();
        assert.equal(await choice.isChecked(), true, 'Card click or keyboard Space must select the ballot');
        assert.equal(await page.locator('input[name="native-choice"]:checked').count(), 1);
        await page.locator('#native-cast').click();
        await waitOperation(page);
        assert.equal(await page.locator('#native-ballots').textContent(), String(index + 1));
        assert.equal(await page.locator('input[name="native-choice"]:checked').count(), 0, 'Private choice must clear after casting');
        assert.equal(await page.locator('#native-voter').inputValue(), '', 'Voter selection must clear before a public receipt is displayed');
        assert.equal(await page.locator(`#native-voter option[value="${voterOrder[index]}"]`).isDisabled(), true, 'Used credential must be unavailable');
        publicReceipts.push(await downloadJson(page, '#native-save-receipt'));
      }
      assert.equal(await page.locator('#native-cast').isDisabled(), true, 'No unused synthetic credential is available');
      assert.equal(await page.locator('#native-ballot-list .ballot-item').count(), voterCount);

      stage = `trustees-${pair.replace(',', '-')}:rendered-qr-and-json-receipts`;
      const receipt = await downloadJson(page, '#native-save-receipt');
      exactKeys(receipt, ['schema', 'execution', 'network', 'contractAddress', 'electionId', 'configurationDigest',
        'index', 'receipt', 'proofGenerated', 'ledgerInclusionVerified'], 'Receipt');
      assert.equal(receipt.proofGenerated, false);
      assert.equal(receipt.ledgerInclusionVerified, false);
      assert.equal(receipt.network, null);
      assert.equal(receipt.index, voterCount - 1);
      const png = pngjs.PNG.sync.read(await page.locator('#native-receipt-qr svg').screenshot());
      const qr = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      assert.ok(qr, 'Independent decoder could not read the rendered receipt QR');
      const fields = [receipt.contractAddress, receipt.electionId, receipt.configurationDigest, receipt.receipt];
      const expectedQr = `mbne1:${receipt.index}:${Buffer.concat(fields.map(value => Buffer.from(value, 'hex'))).toString('base64url')}`;
      assert.equal(qr.data, expectedQr, 'Rendered QR does not encode the downloaded public receipt');
      await page.locator('[data-native-nav="check"]').click();
      await checkReceipt(page, qr.data, true);
      await checkReceipt(page, JSON.stringify(receipt), true);
      await uploadReceipt(page, JSON.stringify(receipt)); await checkLoadedReceipt(page, true);
      await uploadReceipt(page, qr.data, 'saved-receipt.txt'); await checkLoadedReceipt(page, true);
      for (const [invalid, name] of [
        ['not-json', 'invalid.json'], ['x'.repeat(4097), 'oversize.txt'],
        [JSON.stringify({ ...receipt, secret: 'PRIVATE-FIELD-MUST-BE-REJECTED' }), 'private-fields.json'],
        [JSON.stringify(receipt), 'unknown.bin'],
      ]) await uploadReceipt(page, invalid, name, false);
      for (const field of ['contractAddress', 'electionId', 'configurationDigest', 'receipt']) {
        await checkReceipt(page, JSON.stringify({ ...receipt, [field]: changeDigest(receipt[field]) }), false);
      }
      await checkReceipt(page, JSON.stringify({ ...receipt, index: voterCount }), false);
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
      assert.equal(await page.locator('#native-phase').textContent(), 'Results ready');
      assert.deepEqual(await page.locator('#native-result-bars .result-label strong').allTextContents(), totals.map(String));
      assert.equal(await page.locator('#native-finalize').isDisabled(), true);
      await page.locator('[data-native-nav="check"]').click();
      await page.locator('#native-check-result').click();
      await waitOperation(page);
      assert.match(await page.locator('#native-check-output').textContent(), new RegExp(`Election checks passed for ${voterCount} ballots`));
      const snapshot = await downloadJson(page, '#native-export');
      await waitOperation(page);
      exactKeys(snapshot, ['schema', 'execution', 'network', 'proofGenerated', 'ledgerInclusionVerified', 'warning',
        'contractAddress', 'electionId', 'manifestDigest', 'configurationDigest', 'keysConfigured', 'administrator',
        'opensAt', 'closesAt', 'candidateCount', 'phase', 'accepted', 'publicKey', 'coefficientKey', 'trusteeKeys',
        'aggregateA', 'aggregateB', 'ballots', 'decryptionShares', 'finalizedTotals', 'manifest'], 'Public snapshot');
      assert.equal(snapshot.execution, 'generated-contract-emulator');
      assert.equal(snapshot.network, null);
      assert.equal(snapshot.proofGenerated, false);
      assert.equal(snapshot.ledgerInclusionVerified, false);
      assert.equal(snapshot.accepted, voterCount); assert.equal(snapshot.candidateCount, candidateCount);
      assert.deepEqual(snapshot.finalizedTotals, [...totals, ...Array(5 - candidateCount).fill(0)]);
      assert.deepEqual(snapshot.decryptionShares.map(share => share.index), pair.split(',').map(Number));
      assert.equal(snapshot.manifestDigest, hash(Buffer.from(JSON.stringify(snapshot.manifest))));
      assert.equal(snapshot.configurationDigest, receipt.configurationDigest);
      exactKeys(snapshot.manifest, ['schema', 'execution', 'electionId', 'title', 'candidates',
        'threshold', 'capacity', 'syntheticVoters', 'timingMode', 'durationSeconds', 'opensAt', 'closesAt'], 'Public metadata');
      assert.equal(snapshot.manifest.syntheticVoters, voterCount);
      assert.equal(snapshot.manifest.timingMode, 'manual');
      for (const ballot of snapshot.ballots) exactKeys(ballot, ['index', 'a', 'b', 'nullifier', 'receipt'], 'Public ballot');
      for (const share of snapshot.decryptionShares) exactKeys(share, ['index', 'values'], 'Public trustee contribution');
      await writeFile(join(evidenceDir, `public-trustees-${pair.replace(',', '-')}.json`), JSON.stringify(snapshot, null, 2) + '\n');
      stage = `trustees-${pair.replace(',', '-')}:independent-public-record-verification`;
      const verifierContext = await browser.newContext();
      try {
        const verifierPage = await verifierContext.newPage(); verifierPage.setDefaultTimeout(120_000);
        let verifierErrors = 0;
        verifierPage.on('pageerror', () => { verifierErrors++; });
        await verifierPage.goto(`${origin}${prefix}native.html`, { waitUntil: 'networkidle' });
        await verifierPage.waitForFunction(() => document.getElementById('native-availability').dataset.state === 'ready');
        await verifierPage.locator('[data-native-nav="check"]').click();
        assert.equal(await verifierPage.locator('#native-phase').textContent(), 'Not created');
        assert.equal(await verifierPage.locator('#native-verify-import').isDisabled(), false, 'Fresh-tab verification must not require credentials');
        const publicJson = JSON.stringify(snapshot);
        if (pair === '2,3') {
          await verifierPage.locator('#native-import-file').setInputFiles({ name: 'public-snapshot.json', mimeType: 'application/json', buffer: Buffer.from(publicJson) });
          await waitOperation(verifierPage);
        } else await verifierPage.locator('#native-import-text').fill(publicJson);
        await verifierPage.locator('#native-expected-digest').fill(snapshot.configurationDigest);
        await verifierPage.locator('#native-verify-import').click(); await waitOperation(verifierPage);
        assert.match(await verifierPage.locator('#native-check-output').textContent(), /Record checks passed/);
        assert.equal(await verifierPage.locator('#native-check-source').inputValue(), 'import');
        for (const savedReceipt of publicReceipts) await checkReceipt(verifierPage, JSON.stringify(savedReceipt), true);
        await uploadReceipt(verifierPage, JSON.stringify(receipt)); await checkLoadedReceipt(verifierPage, true);
        await checkReceipt(verifierPage, qr.data, true);
        await checkReceipt(verifierPage, JSON.stringify({ ...receipt, receipt: changeDigest(receipt.receipt) }), false);
        assert.equal(await verifierPage.locator('#native-phase').textContent(), 'Not created');
        assert.equal(await verifierPage.locator('#native-voters').textContent(), '—');
        const alteredSnapshot = structuredClone(snapshot);
        alteredSnapshot.finalizedTotals[0] += 1;
        await verifierPage.locator('#native-import-text').fill(JSON.stringify(alteredSnapshot));
        assert.equal(await verifierPage.locator('#native-check-receipt').isDisabled(), true, 'Changing an import must invalidate its verification context');
        await verifierPage.locator('#native-verify-import').click();
        await verifierPage.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
        assert.equal(await verifierPage.locator('#native-check-output').evaluate(element => element.classList.contains('failure')), true);
        assert.equal(await verifierPage.locator('#native-check-receipt').isDisabled(), true);
        await verifierPage.locator('#native-import-text').fill(publicJson);
        await verifierPage.locator('#native-verify-import').click(); await waitOperation(verifierPage);
        await checkReceipt(verifierPage, qr.data, true);
        if (pair === '2,3') await verifierPage.screenshot({ path: join(evidenceDir, 'independent-public-verification.png'), fullPage: true });
        await uploadReceipt(verifierPage, JSON.stringify(receipt));
        await verifierPage.locator('#native-reset').click();
        assert.equal(await verifierPage.locator('#native-import-text').inputValue(), '');
        assert.equal(await verifierPage.locator('#native-receipt-file').inputValue(), '');
        assert.equal(await verifierPage.locator('#native-receipt-input').inputValue(), '');
        assert.equal(await verifierPage.locator('#native-check-receipt').isDisabled(), true);
        assert.equal(await verifierPage.evaluate(() => localStorage.length + sessionStorage.length), 0);
        assert.equal(verifierErrors, 0);
      } finally { await verifierContext.close(); }
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
      await uploadReceipt(page, JSON.stringify(receipt)); await checkLoadedReceipt(page, false);
      assert.equal(await page.evaluate(() => localStorage.length), 0, 'Demo private state must not persist in localStorage');
      assert.equal(await page.evaluate(() => sessionStorage.length), 0, 'Demo private state must not persist in sessionStorage');
      assert.equal(pageErrors, 0, 'Native page produced an uncaught browser error');
      assert.equal(consoleErrors, 0, 'Native page produced a console error');
      for (const urlText of requested) {
        const url = new URL(urlText);
        assert.equal(url.origin, origin, 'Native emulator must not send data to another origin');
      }
      assert.ok(requested.has(`${origin}${prefix}${manifest.bundle}`), 'Actual generated browser bundle must execute');
      evidence.cases.push({ trustees: pair.split(',').map(Number), prefix, entry, passed: true, accepted: voterCount, candidateCount,
        receiptJsonAndTextUploads: true, invalidOversizedAndPrivateFilesRejected: true, uploadedReceiptContextChecked: true,
        freshTabPublicVerification: true, everyReceiptChecked: true, tamperedSnapshotRejected: true,
        clickableCardsChecked: true, keyboardSelectionChecked: true, exactTwoTrusteesChecked: true,
        renderedQrDecoded: true, receiptContextRejections: true, reset: true, wasmLoaded: loadedWasm.size, mobileViewportChecked });
      console.log(JSON.stringify({ stage: `trustees-${pair.replace(',', '-')}`, passed: true }));
    } finally { await context.close(); }
  }

  stage = 'scheduled-preview:real-wall-clock-deadline';
  const scheduledContext = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await scheduledContext.newPage(); page.setDefaultTimeout(120_000);
    const throttling = await scheduledContext.newCDPSession(page);
    await throttling.send('Emulation.setCPUThrottlingRate', { rate: 12 });
    let pageErrors = 0; page.on('pageerror', () => { pageErrors++; });
    await page.goto(`${origin}/arbitrary-repository-name/native.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('native-availability').dataset.state === 'ready');
    assert.equal(await page.locator('#native-candidate-count').inputValue(), '3');
    assert.equal(await page.locator('#native-voter-count').inputValue(), '5');
    await page.locator('#native-timing-mode').selectOption('scheduled');
    for (const duration of ['14', '3601']) {
      await page.locator('#native-duration').fill(duration);
      assert.equal(await page.locator('#native-duration').evaluate(input => input.checkValidity()), false);
    }
    await page.locator('#native-duration').fill('15');
    const startedAt = Date.now();
    await page.locator('#native-create').click(); await waitOperation(page);
    await throttling.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await throttling.detach();
    assert.equal(await page.locator('#native-voters').textContent(), '5');
    assert.match(await page.locator('#native-schedule-status').textContent(), /Timed election/);
    await page.waitForFunction(() => document.getElementById('native-phase').textContent === 'Voting open');
    assert.equal(await page.locator('#native-close').isDisabled(), true, 'Scheduled preview must not expose manual clock advancement');
    await page.locator('#native-go-vote').click();
    await page.locator('#native-voter').selectOption('0');
    await page.locator('#native-choices label:has(input[value="1"])').click();
    await page.locator('#native-cast').click(); await waitOperation(page);
    const receipt = await downloadJson(page, '#native-save-receipt');
    assert.equal(await page.locator('#native-finalize').isDisabled(), true);
    await page.waitForFunction(() => document.getElementById('native-phase').textContent === 'Results ready');
    assert.ok(Date.now() - startedAt >= 15_000, 'Scheduled test must wait for the actual wall-clock duration');
    assert.deepEqual(await page.locator('#native-result-bars .result-label strong').allTextContents(), ['0', '1', '0']);
    await page.locator('[data-native-nav="check"]').click();
    await page.locator('#native-check-result').click(); await waitOperation(page);
    await checkReceipt(page, JSON.stringify(receipt), true);
    const snapshot = await downloadJson(page, '#native-export'); await waitOperation(page);
    assert.equal(snapshot.manifest.timingMode, 'scheduled'); assert.equal(snapshot.manifest.durationSeconds, 15);
    assert.equal(snapshot.closesAt - snapshot.opensAt, 15);
    assert.ok(Date.now() >= snapshot.closesAt * 1000);
    assert.deepEqual(snapshot.finalizedTotals, [0, 1, 0, 0, 0]);
    assert.deepEqual(snapshot.decryptionShares.map(share => share.index), [1, 3]);
    publicOnly(snapshot); assert.equal(snapshot.proofGenerated, false); assert.equal(snapshot.network, null);
    await writeFile(join(evidenceDir, 'public-scheduled-preview.json'), JSON.stringify(snapshot, null, 2) + '\n');
    assert.equal(pageErrors, 0);
    evidence.cases.push({ case: 'scheduled-local-preview', passed: true, realWallClock: true, durationSeconds: 15,
      configuredVoters: 5, setupCpuSlowdown: 12, accepted: 1, candidateCount: 3, trustees: [1, 3], automaticCloseAndFinalize: true, proofGeneration: false, networkSubmission: false });
    console.log(JSON.stringify({ stage: 'scheduled-local-preview', passed: true }));
  } finally { await scheduledContext.close(); }

  stage = 'scheduled-preview:resume-after-deadline';
  const resumedContext = await browser.newContext({ acceptDownloads: true });
  try {
    const page = await resumedContext.newPage(); page.setDefaultTimeout(120_000);
    await page.goto(`${origin}/native.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('native-availability').dataset.state === 'ready');
    await page.locator('#native-voter-count').fill('1');
    await page.locator('#native-candidate-count').selectOption('2');
    await page.locator('#native-timing-mode').selectOption('scheduled');
    await page.locator('#native-duration').fill('15');
    await page.locator('#native-create').click(); await waitOperation(page);
    assert.equal(await page.locator('#native-phase').textContent(), 'Getting ready');
    await page.locator('[data-native-nav="check"]').click();
    const beforeSuspension = await downloadJson(page, '#native-export'); await waitOperation(page);
    // Freeze the real Chromium page lifecycle, without replacing Date, timers,
    // application state or native calls. Wall-clock time continues normally.
    const lifecycle = await resumedContext.newCDPSession(page);
    await lifecycle.send('Page.setWebLifecycleState', { state: 'frozen' });
    const frozenAt = Date.now();
    const resumeAfter = Number(beforeSuspension.closesAt) * 1000 + 1000;
    await new Promise(resolveWait => setTimeout(resolveWait, Math.max(0, resumeAfter - Date.now())));
    assert.ok(Date.now() >= resumeAfter, 'Real wall-clock closing deadline must pass while Chromium is frozen');
    await lifecycle.send('Page.setWebLifecycleState', { state: 'active' });
    await page.waitForFunction(() => document.getElementById('native-phase').textContent === 'Results ready');
    await lifecycle.detach();
    assert.deepEqual(await page.locator('#native-result-bars .result-label strong').allTextContents(), ['0', '0']);
    await page.locator('[data-native-nav="check"]').click();
    await page.locator('#native-check-result').click(); await waitOperation(page);
    const snapshot = await downloadJson(page, '#native-export'); await waitOperation(page);
    assert.equal(snapshot.accepted, 0); assert.deepEqual(snapshot.finalizedTotals, [0, 0, 0, 0, 0]);
    assert.deepEqual(snapshot.decryptionShares.map(share => share.index), [1, 3]);
    assert.ok(Date.now() >= Number(snapshot.closesAt) * 1000);
    evidence.cases.push({ case: 'scheduled-preview-resumed-after-deadline', passed: true,
      realChromiumLifecycleFrozen: true, realWallClock: true, durationSeconds: 15, accepted: 0,
      frozenElapsedMs: Date.now() - frozenAt,
      trustees: [1, 3], automaticCloseAndFinalize: true, proofGeneration: false, networkSubmission: false });
    console.log(JSON.stringify({ stage: 'scheduled-preview-resumed-after-deadline', passed: true }));
  } finally { await resumedContext.close(); }

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
      await page.goto(`${origin}/arbitrary-repository-name/native.html`, { waitUntil: 'networkidle' });
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
