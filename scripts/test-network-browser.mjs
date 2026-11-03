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
      assert.equal(await page.evaluate(() => typeof globalThis.midnight), 'undefined', 'Acceptance profile must have no injected wallet');
      assert.match(await page.locator('#network-wallet-note').textContent(), /No compatible wallet detected/);
      assert.match(await page.locator('#network-availability').textContent(), /Nothing has been proved or submitted/);
      assert.equal(await page.locator('#network-id').inputValue(), '', 'No network may be selected by default');
      assert.equal(await page.locator('#network-id option[value="mainnet"]').count(), 0);
      for (const selector of ['#network-deploy', '#network-join', '#network-cast', '#network-finalize']) {
        assert.equal(await page.locator(selector).isDisabled(), true, 'Network actions need an actual connected wallet');
      }
      for (const asset of manifest.wasmAssets) assert.ok(wasmResponses.has(`${prefix}${asset}`), 'Actual same-origin WASM must load');
      for (const asset of manifest.circuitAssets) {
        const response = await page.request.head(`${origin}${prefix}${asset.path}`);
        assert.equal(response.status(), 200); assert.notEqual(response.headers()['content-type'], 'text/html');
      }
      if (prefix === '/') await page.screenshot({ path: join(evidenceDirectory, 'network-ready-no-wallet.png'), fullPage: false });

      stage = `${prefix}:no-wallet-failure`;
      await page.locator('#network-id').selectOption('preview');
      await page.locator('#network-indexer').fill('https://indexer.example.invalid/graphql');
      await page.locator('#network-indexer-ws').fill('wss://indexer.example.invalid/graphql/ws');
      // Synthetic storage-password fixture, never a wallet seed or real account.
      await page.locator('#network-password').fill('Browser-Test-Q7#M2!');
      await page.locator('#network-connect-form button[type="submit"]').click();
      await page.waitForFunction(() => document.getElementById('network-status').textContent.includes('did not complete'));
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
        pageErrors, consoleErrors, remoteRequests: 0 });
    } finally { await context.close(); }
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
