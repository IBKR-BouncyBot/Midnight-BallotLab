/** Real SDK/WASM loading and no-wallet fail-closed checks in Chromium.
 * No injected wallet, fake proof provider, mock arithmetic or network submission.
 * Raw console messages/errors and Playwright traces are never retained.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const evidenceDirectory = join(root, 'artifacts/network-browser');
const requireContracts = createRequire(join(root, 'contracts/package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const previewNode = 'https://rpc.preview.midnight.network/';
const previewIndexer = 'https://indexer.preview.midnight.network/api/v4/graphql';
const previewWebSocket = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
const evidence = { executedAt: new Date().toISOString(), node: process.version,
  execution: 'real-sdk-and-wasm-browser-loading', walletConnected: false,
  proofGeneration: false, networkSubmission: false, independentChainVerification: false, cases: [] };
let stage = 'build-prerequisites', server, browser;

async function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.wasm': 'application/wasm' };
  const instance = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
      let pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (pathname === '/favicon.ico') return response.writeHead(204).end();
      if (pathname.startsWith('/project-prefix/')) pathname = pathname.slice('/project-prefix'.length);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const target = resolve(dist, `.${pathname}`);
      if (!target.startsWith(`${dist}${sep}`)) return response.writeHead(403).end();
      const bytes = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolveListen, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', resolveListen); });
  return instance;
}

async function sanitizedImportDiagnostic(page, url) {
  // A module import can fail inside the loader's catch, without a pageerror.
  // Return only an allowlisted category and generated line numbers, no message.
  return page.evaluate(async bundleUrl => {
    try { await import(bundleUrl); return { import: 'passed' }; }
    catch (error) {
      const message = typeof error?.message === 'string' ? error.message : '';
      const stack = typeof error?.stack === 'string' ? error.stack : '';
      const categories = [
        ['missing-buffer-global', /Buffer is not defined/], ['missing-process-global', /process is not defined/],
        ['wasm-initialization-order', /__wbindgen_start|before initialization/],
        ['wasm-fetch-or-compile', /WebAssembly|wasm|fetch/i],
        ['module-reference-error', /is not defined/], ['missing-browser-global', /global is not defined/],
      ].filter(([, pattern]) => pattern.test(message)).map(([name]) => name);
      const location = /network-bundle\.mjs:(\d+):(\d+)/.exec(stack);
      return { import: 'failed', categories, ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}) };
    }
  }, url);
}

try {
  await mkdir(evidenceDirectory, { recursive: true });
  const manifest = JSON.parse(await readFile(join(dist, 'network-build.json'), 'utf8'));
  assert.equal(manifest.enabled, true, 'A real successful network browser build is required');
  assert.equal(manifest.bundle, 'network-bundle.mjs');
  assert.equal(manifest.mode, 'development-network-client');
  assert.equal(manifest.circuitAssets.length, 21);
  assert.equal(manifest.wasmAssets.length, 2);
  evidence.bundleSha256 = hash(await readFile(join(dist, manifest.bundle)));
  evidence.compiler = manifest.compiler; evidence.runtime = manifest.runtime; evidence.sdk = manifest.sdk;
  evidence.circuitAssets = [];
  for (const asset of manifest.circuitAssets) {
    assert.match(asset.path, /^native-contract\/(?:keys|zkir)\/[A-Za-z]+\.(?:prover|verifier|bzkir)$/);
    const bytes = await readFile(join(dist, asset.path));
    assert.equal(bytes.length, asset.bytes); assert.equal(hash(bytes), asset.sha256);
    evidence.circuitAssets.push({ path: asset.path, bytes: bytes.length, sha256: asset.sha256 });
  }
  const { chromium } = requireContracts('playwright');
  evidence.playwright = requireContracts('playwright/package.json').version;
  stage = 'launch-chromium';
  browser = await chromium.launch({ headless: true }); evidence.chromium = browser.version();
  server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const prefix of ['/', '/project-prefix/']) {
    stage = `${prefix}:load-real-sdk`;
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(120_000);
      const requests = new Set(), wasmResponses = new Set();
      let pageErrors = 0, consoleErrors = 0;
      const consoleCategories = new Set();
      page.on('pageerror', () => { pageErrors++; });
      page.on('console', message => {
        if (message.type() !== 'error') return;
        consoleErrors++;
        const text = message.text();
        if (/Content.Security.Policy|source list|directive|CSP/i.test(text)) consoleCategories.add('content-security-policy');
        else if (/404|Failed to load resource/i.test(text)) consoleCategories.add('resource-load');
        else consoleCategories.add('unclassified-console-error');
      });
      page.on('request', request => requests.add(request.url()));
      page.on('response', response => { if (response.ok() && response.url().endsWith('.wasm')) wasmResponses.add(new URL(response.url()).pathname); });
      await page.goto(`${origin}${prefix}network.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => ['ready', 'unavailable'].includes(document.getElementById('network-availability').dataset.state));
      const diagnostic = await sanitizedImportDiagnostic(page, `${origin}${prefix}network-bundle.mjs`);
      if (diagnostic.import !== 'passed') evidence.importFailure = diagnostic;
      assert.equal(diagnostic.import, 'passed', 'Real SDK module must import in browser; see sanitized evidence category');
      assert.equal(await page.locator('#network-availability').getAttribute('data-state'), 'ready');
      const font = await page.evaluate(async () => { await document.fonts.ready; return {
        loaded: document.fonts.check('16px Outfit'), family: getComputedStyle(document.body).fontFamily }; });
      assert.equal(font.loaded, true); assert.match(font.family, /Outfit/);
      assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined', 'Acceptance profile must have no injected wallet');
      assert.match(await page.locator('#network-wallet-note').textContent(), /No compatible wallet detected/);
      assert.match(await page.locator('#network-availability').textContent(), /No proof or transaction has been created/);
      stage = `${prefix}:public-preview-default`;
      assert.equal(await page.locator('#network-id').inputValue(), 'preview', 'The public Preview preset must be selected');
      assert.deepEqual(await page.locator('#network-id option').evaluateAll(options => options.map(option => option.value)),
        ['preview', 'undeployed', 'preprod']);
      assert.equal(await page.locator('#network-id option[value="mainnet"]').count(), 0);
      assert.equal(await page.locator('#network-indexer').inputValue(), previewIndexer);
      assert.equal(await page.locator('#network-indexer-ws').inputValue(), previewWebSocket);
      for (const id of ['network-indexer', 'network-indexer-ws']) {
        assert.equal(await page.locator(`#${id}`).evaluate(input => input.readOnly), true, 'Shared Preview endpoints must remain pinned');
      }
      assert.equal(await page.locator('#network-service-settings').evaluate(details => details.open), false);
      assert.equal(await page.locator('#network-check-services').isDisabled(), false);
      assert.match(await page.locator('#network-environment-note').textContent(), /No service API key is needed/);
      assert.match(await page.locator('#network-service-status').textContent(), /Not checked yet.*does not connect a wallet or submit a transaction/);
      assert.match(await page.locator('.public-network-intro').first().textContent(), /do not need to run your own node or indexer/);
      assert.match(await page.locator('.public-network-intro').first().textContent(), /local prover processes private data/);
      const laceSetup = page.locator('details.public-network-intro');
      assert.equal(await laceSetup.locator('summary').textContent(), 'How to set up Lace');
      await laceSetup.locator('summary').click();
      const laceSetupText = await laceSetup.textContent();
      for (const instruction of ['Generate tDUST', 'Review transaction', 'Confirm', 'Receiving test NIGHT alone does not start DUST generation']) {
        assert.ok(laceSetupText.includes(instruction), 'Lace setup instructions must explain each DUST registration step');
      }
      if (prefix === '/') {
        for (const viewport of [1365, 390, 320]) {
          await page.setViewportSize({ width: viewport, height: 1000 });
          const height = await laceSetup.evaluate(element => element.getBoundingClientRect().height);
          await page.setViewportSize({ width: viewport, height: Math.ceil(height) + 40 });
          await page.mouse.move(0, 0);
          await laceSetup.screenshot({ path: join(evidenceDirectory, `lace-setup-guide-${viewport}.png`), animations: 'disabled' });
        }
        await page.setViewportSize({ width: 1365, height: 1000 });
      }
      await laceSetup.locator('summary').click();
      for (const href of ['https://midnight-tmnight-preview.nethermind.dev/', 'https://docs.midnight.network/guides/run-proof-server',
        './network-guide.html#select-preview-in-lace', './network-guide.html#wallet-compatibility',
        './network-guide.html#external-scheduled-development-operator', './license.html']) {
        const link = page.locator(`a[href="${href}"]`);
        assert.equal(await link.count(), 1);
        assert.equal(await link.getAttribute('target'), '_blank');
        assert.match(await link.getAttribute('rel'), /noopener/);
        assert.equal(await link.getAttribute('download'), null);
      }
      const laceGuide = await page.request.get(`${origin}${prefix}network-guide.html`);
      assert.equal(laceGuide.status(), 200);
      assert.match(await laceGuide.text(), /\bid="select-preview-in-lace"/, 'The linked Lace setup section must exist in the built guide');
      stage = `${prefix}:required-password-and-service-fields`;
      assert.equal(await page.locator('#network-password').evaluate(input => input.required && input.validity.valueMissing), true);
      await page.locator('#network-connect').click();
      assert.equal(await page.locator('#network-status').isVisible(), false, 'Required password validation must prevent a connection attempt');
      assert.match(await page.locator('#network-connection-status').textContent(), /Enter a password of at least 16 characters.*separate from your Lace password/);
      assert.equal(await page.locator('#network-connection-status').getAttribute('role'), 'status');
      assert.equal(await page.locator('#network-connection-status').getAttribute('aria-live'), 'polite');
      await page.locator('#network-id').selectOption('undeployed');
      assert.equal(await page.locator('#network-indexer').inputValue(), 'http://127.0.0.1:8088/api/v4/graphql');
      assert.equal(await page.locator('#network-indexer-ws').inputValue(), 'ws://127.0.0.1:8088/api/v4/graphql/ws');
      assert.equal(await page.locator('#network-service-settings').evaluate(details => details.open), true);
      assert.equal(await page.locator('#network-check-services').isDisabled(), true);
      assert.match(await page.locator('#network-environment-note').textContent(), /own running node, indexer and prover/);
      for (const id of ['network-indexer', 'network-indexer-ws']) assert.equal(await page.locator(`#${id}`).evaluate(input => input.readOnly), false);
      await page.locator('#network-indexer').fill('http://localhost:8088/api/v4/graphql');
      await page.locator('#network-indexer-ws').fill('ws://localhost:8088/api/v4/graphql/ws');
      assert.equal(await page.locator('#network-indexer').inputValue(), 'http://localhost:8088/api/v4/graphql');
      await page.locator('#network-id').selectOption('preprod');
      assert.equal(await page.locator('#network-check-services').isDisabled(), true);
      assert.match(await page.locator('#network-environment-note').textContent(), /own working service access/);
      assert.match(await page.locator('#network-environment-note').textContent(), /Do not use the retired/);
      for (const id of ['network-indexer', 'network-indexer-ws']) {
        assert.equal(await page.locator(`#${id}`).inputValue(), '', 'Preprod must not inherit another network’s endpoints');
        assert.equal(await page.locator(`#${id}`).evaluate(input => !input.readOnly && input.required && input.validity.valueMissing), true);
      }
      // This is an inert password fixture, never a wallet seed or real credential.
      await page.locator('#network-password').fill('Browser-Test-Q7#M2!');
      await page.locator('#network-indexer').fill('https://indexer.example.invalid/graphql');
      await page.locator('#network-connect').click();
      assert.equal(await page.locator('#network-status').isVisible(), false, 'A missing WebSocket service must prevent submission');
      assert.match(await page.locator('#network-connection-status').textContent(), /Complete the highlighted connection setting.*No wallet request has been sent/);
      await page.locator('#network-indexer').fill('');
      await page.locator('#network-indexer-ws').fill('wss://indexer.example.invalid/graphql/ws');
      await page.locator('#network-connect').click();
      assert.equal(await page.locator('#network-status').isVisible(), false, 'A missing HTTP service must prevent submission');
      await page.locator('#network-password').fill('');
      await page.locator('#network-id').selectOption('preview');
      assert.equal(await page.locator('#network-indexer').inputValue(), previewIndexer);
      assert.equal(await page.locator('#network-indexer-ws').inputValue(), previewWebSocket);
      for (const id of ['network-indexer', 'network-indexer-ws']) assert.equal(await page.locator(`#${id}`).evaluate(input => input.readOnly), true);
      assert.equal(await page.locator('#network-service-settings').evaluate(details => details.open), false);
      assert.equal(await page.locator('#network-events').textContent(), '');
      assert.ok([...requests].every(url => new URL(url).origin === origin), 'Changing presets must not contact services or wallets');
      for (const [fieldset, name] of [['network-selection', 'network-choice'], ['network-trustee', 'network-trustee'], ['network-pair', 'network-pair']]) {
        assert.equal(await page.locator(`#${fieldset}`).evaluate(element => element.tagName), 'FIELDSET');
        assert.equal(await page.locator(`#${fieldset} label.selection-card`).count(), name === 'network-choice' ? 5 : 3);
        assert.equal(await page.locator(`#${fieldset} label.selection-card:visible`).count(), 3);
        assert.equal(await page.locator(`input[name="${name}"]:checked`).count(), 0);
        for (const input of await page.locator(`input[name="${name}"]`).all()) assert.equal(await input.isDisabled(), true,
          'Ballot and trustee cards must remain disabled without a connected election');
      }
      for (const selector of ['#network-deploy', '#network-join', '#network-cast', '#network-finalize']) {
        assert.equal(await page.locator(selector).isDisabled(), true, 'Network actions need an actual connected wallet');
      }
      for (const asset of manifest.wasmAssets) assert.ok(wasmResponses.has(`${prefix}${asset}`), 'Actual same-origin WASM must load');
      for (const asset of manifest.circuitAssets) {
        const response = await page.request.head(`${origin}${prefix}${asset.path}`);
        assert.equal(response.status(), 200); assert.notEqual(response.headers()['content-type'], 'text/html');
      }
      if (prefix === '/') await page.screenshot({ path: join(evidenceDirectory, 'network-ready-no-wallet.png'), fullPage: false });
      for (const viewport of [390, 320]) {
        await page.setViewportSize({ width: viewport, height: 844 });
        const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth,
          content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
        assert.equal(width.viewport, viewport);
        assert.ok(width.content <= width.viewport + 1, 'Network UI must fit the mobile viewport');
      }
      await page.setViewportSize({ width: 1365, height: 1000 });

      stage = `${prefix}:no-wallet-failure`;
      // Synthetic storage-password fixture, never a wallet seed or real account.
      await page.locator('#network-password').fill('Browser-Test-Q7#M2!');
      await page.locator('#network-connect').click();
      await page.waitForFunction(() => document.getElementById('network-status').textContent.startsWith('No compatible wallet is available'));
      const noWalletMessage = await page.locator('#network-status').textContent();
      assert.equal(await page.locator('#network-connection-status').textContent(), noWalletMessage);
      assert.equal(await page.locator('#network-connect-form #network-connection-status').count(), 1,
        'Connection feedback must remain beside the connection controls');
      assert.match(noWalletMessage, /browser where Lace is installed.*enable Midnight.*reload and refresh the wallet list/);
      assert.match(noWalletMessage, /No connection was requested/);
      assert.doesNotMatch(noWalletMessage, /prover|DUST|password|witness/i, 'Missing-wallet guidance must identify the actual prerequisite');
      await page.locator('#network-password').fill('');
      evidence.lastBrowserCounters = { path: prefix, pageErrors, consoleErrors, consoleCategories: [...consoleCategories],
        remoteRequests: [...requests].filter(url => new URL(url).origin !== origin).length };
      stage = `${prefix}:no-wallet-actions-remain-disabled`;
      assert.equal(await page.locator('#network-deploy').isDisabled(), true);
      stage = `${prefix}:no-wallet-no-events`;
      assert.equal(await page.locator('#network-events').textContent(), '');
      stage = `${prefix}:no-wallet-no-remote-requests`;
      assert.ok([...requests].every(url => new URL(url).origin === origin), 'No remote service request is allowed without a wallet');
      stage = `${prefix}:no-wallet-no-runtime-errors`;
      assert.equal(pageErrors, 0, 'Unexpected browser runtime errors');
      stage = `${prefix}:no-wallet-no-console-errors`;
      assert.equal(consoleErrors, 0, 'Unexpected browser console errors');
      evidence.cases.push({ case: 'actual-sdk-load-and-no-wallet-failure', path: prefix, status: 'passed',
        wasmLoaded: wasmResponses.size, circuitAssetsServed: manifest.circuitAssets.length,
        ballotAndTrusteeCardsPresent: true, cardControlsDisabled: true,
        previewDefaultAndPinnedEndpoints: true, localAndPreprodPresets: true, requiredServiceAndPasswordFields: true,
        helpLinksChecked: true, laceSetupGuideChecked: true, inlineRequiredFieldAndWalletFeedback: true, mobileWidths: [390, 320], connectedSessionUiTested: false,
        pageErrors, consoleErrors, remoteRequests: 0 });
    } finally { await context.close(); }
  }

  stage = 'election-setup-chooser';
  {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      let pageErrors = 0, consoleErrors = 0, externalRequests = 0;
      page.on('pageerror', () => { pageErrors++; });
      page.on('console', message => { if (message.type() === 'error') consoleErrors++; });
      page.on('request', request => { if (new URL(request.url()).origin !== origin) externalRequests++; });
      await page.goto(`${origin}/network.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('network-availability').dataset.state === 'ready');
      assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined');
      const create = page.locator('#network-mode-create'), joinButton = page.locator('#network-mode-join');
      assert.equal(await create.getAttribute('aria-pressed'), 'true');
      assert.equal(await joinButton.getAttribute('aria-pressed'), 'false');
      assert.equal(await create.getAttribute('aria-controls'), 'network-create-panel');
      assert.equal(await joinButton.getAttribute('aria-controls'), 'network-join-panel');
      assert.equal(await page.locator('#network-create-panel').isVisible(), true);
      assert.equal(await page.locator('#network-join-panel').isVisible(), false);
      assert.equal(await page.locator('#network-admin').isVisible(), true);
      for (const id of ['network-address', 'network-digest']) assert.equal(await page.locator(`#${id}`).evaluate(input => input.readOnly), true);
      await page.locator('#network-title').fill('Chooser browser check');
      await page.locator('#network-choices').fill('Test A\nTest B');
      await joinButton.focus(); await page.keyboard.press('Enter');
      assert.equal(await create.getAttribute('aria-pressed'), 'false');
      assert.equal(await joinButton.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#network-create-panel').isVisible(), false);
      assert.equal(await page.locator('#network-join-panel').isVisible(), true);
      assert.equal(await page.locator('#network-admin').isVisible(), true);
      for (const id of ['network-address', 'network-digest']) assert.equal(await page.locator(`#${id}`).evaluate(input => input.readOnly), false);
      // Public, inert join-field fixtures; no contract operation is requested.
      await page.locator('#network-address').fill('d'.repeat(64));
      await page.locator('#network-digest').fill('e'.repeat(64));
      await create.focus(); await page.keyboard.press('Space');
      assert.equal(await create.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#network-create-panel').isVisible(), true);
      assert.equal(await page.locator('#network-join-panel').isVisible(), false);
      assert.equal(await page.locator('#network-title').inputValue(), 'Chooser browser check');
      assert.equal(await page.locator('#network-choices').inputValue(), 'Test A\nTest B');
      await joinButton.click();
      assert.equal(await page.locator('#network-address').inputValue(), 'd'.repeat(64));
      assert.equal(await page.locator('#network-digest').inputValue(), 'e'.repeat(64));
      for (const viewport of [390, 320]) {
        await page.setViewportSize({ width: viewport, height: 844 });
        assert.equal(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1), true);
      }
      for (const id of ['network-join', 'network-deploy']) assert.equal(await page.locator(`#${id}`).isDisabled(), true);
      assert.equal(await page.locator('#network-events').textContent(), '');
      assert.equal(externalRequests, 0); assert.equal(pageErrors, 0); assert.equal(consoleErrors, 0);
      evidence.cases.push({ case: 'election-setup-chooser', status: 'passed', defaultMode: 'create',
        keyboardActivation: ['Enter', 'Space'], panelVisibility: true, publicFieldPreservation: true,
        administratorControlsShared: true, actionsDisabledWithoutWallet: true, mobileWidths: [390, 320],
        connectedModeLocksTested: false, externalRequests, pageErrors, consoleErrors });
    } finally { await context.close(); }
  }

  stage = 'private-key-file-utilities';
  {
    // This isolated case uses only newly generated synthetic credentials.
    // Never screenshot a page containing a key or retain download bodies in evidence.
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      let pageErrors = 0, consoleErrors = 0, externalRequests = 0;
      page.on('pageerror', () => { pageErrors++; });
      page.on('console', message => { if (message.type() === 'error') consoleErrors++; });
      page.on('request', request => { if (new URL(request.url()).origin !== origin) externalRequests++; });
      await page.goto(`${origin}/network.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('network-availability').dataset.state === 'ready');
      assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined');
      const roleChecks = [];
      for (const role of ['admin', 'voter']) {
        stage = `private-key-${role}:generate-and-reveal`;
        const input = page.locator(`#network-${role}`), toggle = page.locator(`#network-show-${role}`);
        const fileInput = page.locator(`#network-import-${role}`), keyStatus = page.locator(`#network-${role}-key-status`);
        assert.equal(await input.getAttribute('type'), 'password');
        await page.locator(`#network-generate-${role}`).click();
        const key = await input.inputValue();
        assert.match(key, /^[0-9a-f]{64}$/); assert.notEqual(key, '0'.repeat(64));
        assert.equal(await input.getAttribute('type'), 'text', 'Newly generated credential should be visible to its user');
        assert.equal(await toggle.getAttribute('aria-controls'), `network-${role}`);
        assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
        await toggle.click(); assert.equal(await input.getAttribute('type'), 'password');
        assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
        await toggle.click(); assert.equal(await input.getAttribute('type'), 'text');
        await toggle.click(); assert.equal(await input.getAttribute('type'), 'password');

        stage = `private-key-${role}:download-round-trip`;
        const downloaded = page.waitForEvent('download');
        await page.locator(`#network-download-${role}`).click();
        const download = await downloaded;
        assert.equal(download.suggestedFilename(), `midnight-${role === 'admin' ? 'administrator' : 'voter'}-key.private.txt`);
        let privateText;
        try {
          const stream = await download.createReadStream(); assert.ok(stream);
          const chunks = []; let length = 0;
          for await (const chunk of stream) {
            length += chunk.length; assert.ok(length <= 256, 'Private key file must remain bounded'); chunks.push(chunk);
          }
          privateText = Buffer.concat(chunks).toString('utf8');
          assert.equal(privateText, key + '\n', 'Private file contains only the key and one newline');
        } finally { await download.delete(); }
        await input.fill('');
        await fileInput.setInputFiles({ name: 'synthetic-key.txt', mimeType: 'text/plain', buffer: Buffer.from(privateText, 'utf8') });
        await page.waitForFunction(({ id, expected }) => document.getElementById(id).value === expected,
          { id: `network-${role}`, expected: key });
        assert.equal(await input.getAttribute('type'), 'password', 'Restoring a key must mask it');
        assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
        privateText = undefined;
        if (role === 'admin') {
          await page.locator('#network-mode-join').click();
          assert.equal(await input.isVisible(), true); assert.equal(await input.inputValue(), key);
          await page.locator('#network-mode-create').click();
          assert.equal(await input.isVisible(), true); assert.equal(await input.inputValue(), key);
          assert.equal(await input.getAttribute('type'), 'password');
        }
        for (const viewport of [390, 320]) {
          await page.setViewportSize({ width: viewport, height: 844 });
          const fits = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth + 1);
          assert.equal(fits, true, 'Private key controls must fit the mobile viewport');
        }
        await page.setViewportSize({ width: 1365, height: 1000 });

        stage = `private-key-${role}:invalid-file-preserves-current-key`;
        const invalidInputs = [
          ['not-hex', Buffer.from('not-a-private-key')], ['zero-key', Buffer.from('0'.repeat(64))],
          ['short-key', Buffer.from('a'.repeat(63))], ['long-key', Buffer.from('a'.repeat(65))],
          ['oversize', Buffer.from('a'.repeat(257))], ['invalid-utf8', Buffer.from([0xff, 0xfe, 0xff])],
          ['structured-json', Buffer.from(JSON.stringify({ key }))],
          ['wrong-extension', Buffer.from(key), 'withheld-diagnostic-marker.json'],
        ];
        for (const [invalidKind, buffer, filename = 'withheld-diagnostic-marker.txt'] of invalidInputs) {
          stage = `private-key-${role}:reject-${invalidKind}`;
          // Clear the native file-input selection between attempts. The key
          // field remains untouched, so rejection must preserve its real value.
          await fileInput.setInputFiles([]);
          await fileInput.setInputFiles({ name: filename, mimeType: 'text/plain', buffer });
          await page.waitForFunction(id => document.getElementById(id).value === '', `network-import-${role}`);
          assert.match(await keyStatus.textContent(), /^Could not load this key\./);
          assert.equal(await input.inputValue(), key);
          assert.equal(await input.getAttribute('type'), 'password');
          const message = await keyStatus.textContent();
          assert.ok(!message.includes(key) && !message.includes('withheld-diagnostic-marker'));
        }

        stage = `private-key-${role}:public-output-privacy`;
        assert.equal(await page.locator('#network-events').textContent(), '');
        assert.ok(!(await page.locator('body').innerText()).includes(key), 'Secret must not appear in public page text');
        assert.ok(!(await page.locator('#network-public-state').textContent()).includes(key));
        assert.ok(!(await page.locator('#network-receipt-code').textContent()).includes(key));
        assert.ok(!page.url().includes(key));
        await page.locator(`#network-generate-${role}`).click();
        const replacement = await input.inputValue();
        assert.match(replacement, /^[0-9a-f]{64}$/); assert.notEqual(replacement, key);
        await toggle.click(); await input.fill('');
        await fileInput.setInputFiles([]);
        roleChecks.push({ role, generated: true, revealAndHide: true, privateDownloadRoundTrip: true,
          rejectedFiles: invalidInputs.length, invalidImportPreservesKey: true, maskedAfterRestore: true,
          ...(role === 'admin' ? { setupModePreservesKey: true } : {}) });
      }
      assert.equal(externalRequests, 0); assert.equal(pageErrors, 0); assert.equal(consoleErrors, 0);
      assert.equal(await page.locator('#network-export').isDisabled(), true);
      assert.equal(await page.locator('#network-save-receipt').isDisabled(), true);
      // Reload creates a fresh application with no private field values before
      // producing layout evidence. Every private input is checked empty first.
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('network-availability').dataset.state === 'ready');
      for (const id of ['network-password', 'network-admin', 'network-voter', 'network-setup-secret', 'network-setup-slope', 'network-share']) {
        assert.equal(await page.locator(`#${id}`).inputValue(), '');
      }
      for (const viewport of [1365, 390, 320]) {
        await page.setViewportSize({ width: viewport, height: 1000 });
        for (const heading of ['contract-heading', 'vote-heading']) {
          const panel = page.locator(`section[aria-labelledby="${heading}"]`);
          const height = await panel.evaluate(element => element.getBoundingClientRect().height);
          await page.setViewportSize({ width: viewport, height: Math.ceil(height) + 40 });
          await page.mouse.move(0, 0);
          await panel.screenshot({ path: join(evidenceDirectory, `private-controls-empty-${heading}-${viewport}.png`), animations: 'disabled' });
          if (heading === 'contract-heading') {
            await page.locator('#network-mode-join').click();
            const joinHeight = await panel.evaluate(element => element.getBoundingClientRect().height);
            await page.setViewportSize({ width: viewport, height: Math.ceil(joinHeight) + 40 });
            await page.mouse.move(0, 0);
            await panel.screenshot({ path: join(evidenceDirectory, `private-controls-empty-join-${viewport}.png`), animations: 'disabled' });
            await page.locator('#network-mode-create').click();
          }
        }
      }
      evidence.cases.push({ case: 'private-key-file-utilities', status: 'passed', roles: roleChecks,
        generatedKeysRetained: false, downloadBodiesRetained: false, screenshotsOnlyAfterReloadWithEmptyPrivateInputs: true,
        mobileWidths: [390, 320],
        publicExportExecutionTested: false, externalRequests, pageErrors, consoleErrors });
    } finally { await context.close(); }
  }

  for (const failedService of ['node', 'indexer']) {
    stage = `preview-${failedService}-transport-failure`;
    const context = await browser.newContext();
    let releaseSibling;
    const siblingReleased = new Promise(resolveSibling => { releaseSibling = resolveSibling; });
    const routeTasks = [];
    try {
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      let pageErrors = 0, unexpectedConsoleErrors = 0, blockedRequests = 0, targetedRequests = 0, unexpectedRequests = 0;
      const targetedEndpoint = failedService === 'node' ? previewNode : previewIndexer;
      page.on('pageerror', () => { pageErrors++; });
      page.on('console', message => {
        if (message.type() === 'error' && !/Failed to load resource|net::ERR_FAILED|ERR_ABORTED/i.test(message.text())) unexpectedConsoleErrors++;
      });
      // A deliberate transport failure, never a fabricated success response.
      // Hold the other endpoint until the targeted failure reaches the UI, so
      // no public request leaves the test browser and either service is tested.
      await page.route(/^https:\/\//, route => {
        const task = (async () => {
          const endpoint = route.request().url();
          if (![previewNode, previewIndexer].includes(endpoint)) unexpectedRequests++;
          else {
            blockedRequests++;
            if (endpoint === targetedEndpoint) targetedRequests++;
            assert.equal(route.request().method(), 'POST');
          }
          if (endpoint !== targetedEndpoint && [previewNode, previewIndexer].includes(endpoint)) await siblingReleased;
          await route.abort('failed');
        })();
        routeTasks.push(task); return task;
      });
      await page.goto(`${origin}/network.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('network-availability').dataset.state === 'ready');
      assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined');
      assert.equal(blockedRequests, 0, 'Public service checks must require an explicit click');
      await page.locator('#network-check-services').click();
      await page.waitForFunction(() => !document.getElementById('network-check-services').disabled);
      const expected = `Your browser could not reach the public Preview ${failedService}. Check your connection and browser or network restrictions; the service may also be temporarily unavailable. This check did not connect a wallet or submit a transaction.`;
      stage = `preview-${failedService}-transport-failure:service-message`;
      assert.equal(await page.locator('#network-service-status').textContent(), expected);
      stage = `preview-${failedService}-transport-failure:global-message`;
      assert.equal(await page.locator('#network-status').textContent(), expected, 'The global status must preserve the service-specific safe error');
      assert.doesNotMatch(expected, /prover|DUST|password|witness|seed/i);
      stage = `preview-${failedService}-transport-failure:restored-controls`;
      for (const id of ['network-check-services', 'network-connect', 'network-id', 'network-refresh-wallets']) {
        assert.equal(await page.locator(`#${id}`).isDisabled(), false, 'Connection and retry controls must be restored');
      }
      for (const id of ['network-deploy', 'network-join', 'network-cast', 'network-finalize']) {
        assert.equal(await page.locator(`#${id}`).isDisabled(), true);
      }
      assert.equal(await page.locator('#network-password').inputValue(), '');
      assert.equal(await page.locator('#network-events').textContent(), '');
      assert.equal(await page.locator('#network-availability').getAttribute('data-state'), 'ready');
      stage = `preview-${failedService}-transport-failure:request-cleanup`;
      releaseSibling(); await Promise.all(routeTasks);
      evidence.lastTransportFailureCounters = { failedService, blockedRequests, targetedRequests, unexpectedRequests, pageErrors, unexpectedConsoleErrors };
      // The app aborts the sibling on failure; Chromium may cancel it before
      // its route handler is dispatched. The targeted failure is mandatory.
      assert.equal(targetedRequests, 1); assert.ok(blockedRequests >= 1 && blockedRequests <= 2);
      assert.equal(unexpectedRequests, 0);
      assert.equal(pageErrors, 0); assert.equal(unexpectedConsoleErrors, 0);
      evidence.cases.push({ case: `preview-${failedService}-transport-failure`, status: 'passed',
        failureInjection: 'request-abort-only', fabricatedSuccessResponses: 0, externalRequestsAllowed: 0,
        safeServiceMessage: true, controlsRestored: true, walletConnected: false, pageErrors, unexpectedConsoleErrors });
    } finally {
      releaseSibling(); await Promise.allSettled(routeTasks); await context.close();
    }
  }

  for (const failure of ['disabled-manifest', 'missing-wasm']) {
    stage = failure;
    const context = await browser.newContext();
    try {
      const page = await context.newPage(); page.setDefaultTimeout(120_000);
      if (failure === 'disabled-manifest') {
        await page.route('**/network-build.json', route => route.fulfill({ contentType: 'application/json',
          body: JSON.stringify({ enabled: false, reason: 'Acceptance check: native prerequisite unavailable' }) }));
      } else await page.route('**/network-assets/*.wasm', route => route.abort());
      await page.goto(`${origin}/network.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.getElementById('network-availability').dataset.state === 'unavailable');
      assert.equal(await page.locator('[data-network-control]:enabled').count(), 0);
      assert.equal(await page.locator('#network-events').textContent(), '');
      evidence.cases.push({ case: failure, status: 'passed', controls: 'all-disabled' });
    } finally { await context.close(); }
  }
  evidence.status = 'passed';
  await writeFile(join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', cases: evidence.cases.length, evidence: 'artifacts/network-browser/evidence.json',
    walletConnected: false, proofGeneration: false, networkSubmission: false }));
} catch {
  evidence.status = 'failed'; evidence.failedStage = stage;
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.error(JSON.stringify({ status: 'failed', stage, evidence: 'artifacts/network-browser/evidence.json',
    ...(evidence.importFailure ? { importFailure: evidence.importFailure } : {}) }));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(resolveClose => server.close(resolveClose));
}
