/** CI browser gate: real generated-circuit proofs through the actual worker.
 * No wallet, HTTP prover, trace, request body or private preimage is retained.
 * This script is not a replacement for browser-wallet transaction acceptance.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJson } from '../src/json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'artifacts/browser-proof-check');
const output = join(root, 'artifacts/browser-wasm-proofs');
const requireContracts = createRequire(join(root, 'contracts/package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedCircuits = ['configureKeys', 'enroll', 'openVoting', 'castBallot', 'closeVoting', 'submitDecryption', 'submitDecryption', 'finalize'];
const expectedNegatives = [
  { case: 'wrong registered trustee share', outcome: 'rejected by generated circuit', proofRequested: false },
  { case: 'castBallot preimage with enroll key location', outcome: 'rejected by local worker check', proofRequested: false },
];
const allowedStages = new Set(['initialize-worker', ...expectedCircuits, 'reject-wrong-trustee-share', 'reject-mismatched-circuit']);
const prefix = '/project-prefix';
const report = { schema: 'midnight-ballot-lab/browser-wasm-proof-ci/v1', startedAt: new Date().toISOString(),
  status: 'running', node: process.version, scope: 'real dedicated-worker circuit proofs from synthetic browser-memory inputs',
  walletConnected: false, networkSubmission: false, networkAcceptance: false, independentChainVerification: false };
const counts = { forbiddenRequests: 0, serverRejectedRequests: 0, pageErrors: 0, consoleErrors: 0, sockets: 0 };
let browser, server, stage = 'build-validation', approvedPaths;
const requested = new Set();

function exact(value, fields) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort());
}
function publicProofs(value) {
  assert.ok(Array.isArray(value) && value.length <= 8);
  return value.map((item, index) => {
    exact(item, ['circuit', 'constraintCheck', 'proofBytes', 'proofSha256', 'elapsedMs']);
    assert.equal(item.circuit, expectedCircuits[index]); assert.equal(item.constraintCheck, 'passed');
    assert.ok(Number.isSafeInteger(item.proofBytes) && item.proofBytes > 0 && item.proofBytes <= 16 * 1024 * 1024);
    assert.match(item.proofSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(item.elapsedMs) && item.elapsedMs >= 0 && item.elapsedMs <= 16 * 60 * 1000);
    return { ...item };
  });
}
async function checkRecord(path, record) {
  const bytes = await readFile(path);
  assert.equal(bytes.length, record.bytes); assert.equal(hash(bytes), record.sha256);
  return bytes;
}
function publicRequest(url, method) {
  try {
    const value = new URL(url);
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (value.origin !== origin || value.search || value.username || value.password || !['GET', 'HEAD'].includes(method)) return null;
    if (value.pathname === '/favicon.ico' || value.pathname === `${prefix}/favicon.ico`) return 'favicon.ico';
    const path = value.pathname.startsWith(`${prefix}/`) ? value.pathname.slice(prefix.length + 1) : '';
    return approvedPaths.has(path) ? path : null;
  } catch { return null; }
}

try {
  await mkdir(output, { recursive: true });
  const build = JSON.parse(await readFile(join(root, 'dist/network-build.json'), 'utf8'));
  const harnessBuild = JSON.parse(await readFile(join(site, 'proof-check-build.json'), 'utf8'));
  assert.equal(build.enabled, true); assert.equal(build.browserProver.version, '2.1.1');
  assert.equal(build.browserProver.execution, 'dedicated-worker');
  assert.equal(build.browserProver.parameters.length, 5); assert.equal(build.circuitAssets.length, 21);
  assert.equal(harnessBuild.workerSha256, build.browserProver.worker.sha256);
  assert.equal(harnessBuild.assetManifestSha256, build.browserProver.manifest.sha256);
  const copiedAssets = [build.browserProver.worker, build.browserProver.manifest,
    ...build.browserProver.parameters, ...build.circuitAssets];
  for (const asset of copiedAssets) {
    await checkRecord(join(root, 'dist', asset.path), asset);
    await checkRecord(join(site, asset.path), asset);
  }
  for (const path of build.wasmAssets) {
    assert.match(path, /^network-assets\/[A-Za-z0-9_-]+\.wasm$/);
    assert.ok((await readFile(join(root, 'dist', path))).equals(await readFile(join(site, path))));
  }
  const harness = await readFile(join(site, 'proof-check-bundle.mjs'));
  assert.equal(hash(harness), harnessBuild.harnessSha256);
  const harnessWasm = (await readdir(join(site, 'proof-check-assets'))).filter(name => /^[A-Za-z0-9_-]+\.wasm$/.test(name));
  assert.equal(harnessWasm.length, 2, 'Narrow harness must initialize actual ledger and onchain WASM');
  approvedPaths = new Set(['proof-check.html', 'proof-check.css', 'proof-check-bundle.mjs',
    ...copiedAssets.map(asset => asset.path), ...build.wasmAssets, ...harnessWasm.map(name => `proof-check-assets/${name}`)]);
  report.build = { worker: build.browserProver.worker, manifest: build.browserProver.manifest,
    harnessSha256: hash(harness), networkBundleSha256: hash(await readFile(join(root, 'dist/network-bundle.mjs'))),
    circuitAssets: build.circuitAssets.length, publicParameters: build.browserProver.parameters.length };
  const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm' };
  server = createServer(async (request, response) => {
    const path = publicRequest(`http://127.0.0.1:${server.address().port}${request.url}`, request.method);
    if (!path) { counts.serverRejectedRequests++; response.writeHead(403).end(); return; }
    if (path === 'favicon.ico') { response.writeHead(204).end(); return; }
    try {
      const bytes = await readFile(join(site, path));
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); });
  const { chromium } = requireContracts('playwright');
  report.playwright = requireContracts('playwright/package.json').version;
  stage = 'browser-launch';
  browser = await chromium.launch({ headless: true }); report.chromium = browser.version();
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
  await context.route('**/*', async route => {
    const request = route.request(), path = publicRequest(request.url(), request.method());
    if (!path) { counts.forbiddenRequests++; await route.abort(); return; }
    requested.add(path); await route.continue();
  });
  // Dedicated-worker requests are also observed at context level. Retain only
  // counts and known public relative paths, never arbitrary URLs or payloads.
  context.on('request', request => {
    if (!publicRequest(request.url(), request.method())) counts.forbiddenRequests++;
  });
  await context.routeWebSocket('**/*', socket => { counts.sockets++; socket.close(); });
  const page = await context.newPage(); page.setDefaultTimeout(120_000);
  page.on('pageerror', () => { counts.pageErrors++; });
  page.on('console', event => { if (event.type() === 'error') counts.consoleErrors++; });
  stage = 'browser-startup';
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}/proof-check.html`, { waitUntil: 'networkidle' });
  await page.locator('#run-browser-proofs:enabled').waitFor();
  const environment = await page.evaluate(() => ({ crossOriginIsolated,
    walletPresent: typeof globalThis.midnight !== 'undefined' }));
  assert.equal(environment.crossOriginIsolated, false, 'Proofs must work without special hosting isolation headers');
  assert.equal(environment.walletPresent, false); report.browserEnvironment = environment;
  stage = 'circuit-proofs';
  await page.locator('#run-browser-proofs').click();
  const deadline = Date.now() + 35 * 60 * 1000;
  let raw, lastCount = -1;
  for (;;) {
    assert.ok(Date.now() < deadline, 'Browser proof gate timed out');
    const text = await page.locator('#proof-report').textContent();
    raw = parseStrictJson(text, { maxBytes: 128 * 1024, maxDepth: 8 });
    report.completedProofs = publicProofs(raw.proofs);
    if (report.completedProofs.length !== lastCount) {
      lastCount = report.completedProofs.length;
      console.log(JSON.stringify({ stage: 'actual-browser-proofs', completedProofs: lastCount, expectedProofs: 8 }));
    }
    if (raw.status !== 'running') break;
    if (counts.forbiddenRequests || counts.sockets || counts.pageErrors || counts.consoleErrors) throw new Error('Browser proof gate rejected an unexpected event');
    await new Promise(resolvePoll => setTimeout(resolvePoll, 2000));
  }
  stage = 'proof-report-validation';
  if (raw.status !== 'passed') {
    report.failedCircuitStage = allowedStages.has(raw.failedStage) ? raw.failedStage : 'unclassified';
    throw new Error('Real browser proof sequence did not pass');
  }
  exact(raw, ['schema', 'startedAt', 'execution', 'status', 'versions', 'candidateCount', 'proofs', 'negativeChecks',
    'witnessSource', 'httpProofProviderConfigured', 'workerAssetPolicy', 'mainPageConnectCsp', 'walletExecution',
    'networkSubmission', 'networkAcceptance', 'independentProofVerification', 'distinctCircuitsProved', 'phase',
    'acceptedBallots', 'finishedAt']);
  assert.equal(raw.schema, 'midnight-ballot-lab/browser-circuit-proofs/v1');
  assert.deepEqual(raw.versions, { compiler: '0.31.1', runtime: '0.16.0', midnightJs: '4.1.1', zkir: '2.1.1' });
  assert.equal(raw.execution, 'generated-contract-proofs-in-dedicated-browser-worker');
  assert.equal(raw.witnessSource, 'fresh-synthetic-browser-memory');
  assert.equal(raw.httpProofProviderConfigured, false);
  assert.equal(raw.workerAssetPolicy, 'same-origin-public-GET-with-size-and-SHA256');
  assert.equal(raw.mainPageConnectCsp, "connect-src 'self'");
  assert.equal(raw.walletExecution, 'not-attempted'); assert.equal(raw.networkSubmission, 'not-attempted');
  assert.equal(raw.networkAcceptance, 'not-tested'); assert.equal(raw.independentProofVerification, 'not-tested');
  assert.equal(raw.candidateCount, 5); assert.equal(raw.phase, 3); assert.equal(raw.acceptedBallots, 1);
  assert.equal(raw.distinctCircuitsProved, 7); assert.equal(raw.proofs.length, 8);
  assert.deepEqual(raw.negativeChecks, expectedNegatives);
  for (const time of [raw.startedAt, raw.finishedAt]) assert.ok(typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(time) && Number.isFinite(Date.parse(time)));
  assert.deepEqual(counts, { forbiddenRequests: 0, serverRejectedRequests: 0, pageErrors: 0, consoleErrors: 0, sockets: 0 });
  report.status = 'passed'; report.circuitReport = raw;
  await page.locator('#proof-report').screenshot({ path: join(output, 'public-proof-report.png'), animations: 'disabled' });
  stage = 'complete';
} catch {
  report.status = 'failed'; report.failedStage = stage; process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  if (server) await new Promise(resolveClosed => server.close(resolveClosed));
  report.finishedAt = new Date().toISOString(); report.requestCounts = counts;
  report.requestedPublicAssets = [...requested].sort();
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, stage, completedProofs: report.completedProofs?.length ?? 0,
    evidence: 'artifacts/browser-wasm-proofs/evidence.json', walletConnected: false, networkSubmission: false }));
}
