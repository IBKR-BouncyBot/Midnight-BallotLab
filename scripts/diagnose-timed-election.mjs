/** Local, real-browser timed-election regression. Arguments: voters cpuSlowdown seconds label.
 * CPU throttling emulates a slower device. Date, timers and native code stay real.
 * Retains only public timing, counts and build hashes, never raw browser errors.
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
const requireContracts = createRequire(join(root, 'contracts/package.json'));
const voters = Number(process.argv[2] ?? 5), cpuSlowdown = Number(process.argv[3] ?? 6);
const durationSeconds = Number(process.argv[4] ?? 60), label = process.argv[5] ?? 'current';
const evidence = { executedAt: new Date().toISOString(), execution: 'real-local-chromium',
  voters, cpuSlowdown, durationSeconds, proofGeneration: false, networkSubmission: false, stages: [] };
let browser, server, stage = 'arguments';
let evidenceFile;
try {
  assert.ok(Number.isInteger(voters) && voters >= 1 && voters <= 1024);
  assert.ok(Number.isFinite(cpuSlowdown) && cpuSlowdown >= 1 && cpuSlowdown <= 20);
  assert.ok(Number.isInteger(durationSeconds) && durationSeconds >= 15 && durationSeconds <= 3600);
  assert.match(label, /^[a-z0-9-]{1,40}$/);
  const directory = join(root, 'artifacts/timed-election'); await mkdir(directory, { recursive: true });
  evidenceFile = join(directory, `${label}-voters-${voters}-cpu-${cpuSlowdown}.json`);
  const manifest = JSON.parse(await readFile(join(dist, 'native-build.json'), 'utf8'));
  assert.equal(manifest.enabled, true);
  evidence.bundleSha256 = createHash('sha256').update(await readFile(join(dist, manifest.bundle))).digest('hex');
  evidence.compiler = manifest.compiler; evidence.runtime = manifest.runtime;
  const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json',
    '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
  server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
      let path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (path === '/favicon.ico') return response.writeHead(204).end();
      if (path.endsWith('/')) path += 'index.html';
      const target = resolve(dist, `.${path}`);
      if (!target.startsWith(`${dist}${sep}`)) return response.writeHead(403).end();
      const bytes = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const { chromium } = requireContracts('playwright');
  evidence.playwright = requireContracts('playwright/package.json').version;
  browser = await chromium.launch({ headless: true }); evidence.chromium = browser.version();
  const context = await browser.newContext();
  const page = await context.newPage(); page.setDefaultTimeout(180_000);
  let runtimeErrors = 0, offOriginRequests = 0;
  const origin = `http://127.0.0.1:${server.address().port}`;
  page.on('pageerror', () => { runtimeErrors++; });
  page.on('request', request => { if (new URL(request.url()).origin !== origin) offOriginRequests++; });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown });
  stage = 'load-real-native-browser';
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => ['ready', 'error', 'unavailable'].includes(document.getElementById('native-availability').dataset.state));
  assert.equal(await page.locator('#native-availability').getAttribute('data-state'), 'ready');
  await page.locator('#native-voter-count').fill(String(voters));
  await page.locator('#native-timing-mode').selectOption('scheduled');
  await page.locator('#native-duration').fill(String(durationSeconds));
  stage = 'create-timed-election'; const startedAt = Date.now();
  await page.locator('#native-create').click();
  await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
  const creation = { stage, elapsedMs: Date.now() - startedAt, phase: await page.locator('#native-phase').textContent(),
    error: await page.locator('#native-status').evaluate(element => element.classList.contains('error')) };
  evidence.stages.push(creation); console.log(JSON.stringify(creation));
  assert.equal(creation.error, false, 'Timed election creation must finish');
  assert.notEqual(creation.phase, 'Not created');
  stage = 'wait-for-real-opening';
  await page.waitForFunction(() => document.getElementById('native-phase').textContent === 'Voting open');
  evidence.stages.push({ stage, elapsedMs: Date.now() - startedAt });
  stage = 'cast-one-demo-ballot';
  await page.locator('#native-go-vote').click();
  await page.locator('#native-voter').selectOption('0');
  await page.locator('#native-choices label:has(input[value="0"])').click();
  await page.locator('#native-cast').click();
  await page.waitForFunction(() => !document.getElementById('native-status').classList.contains('working'));
  assert.equal(await page.locator('#native-ballots').textContent(), '1');
  assert.equal(await page.locator('#native-voter').inputValue(), '');
  evidence.stages.push({ stage, elapsedMs: Date.now() - startedAt, accepted: 1 });
  console.log(JSON.stringify({ stage: 'waiting-for-actual-deadline', durationSeconds }));
  stage = 'automatic-close-and-two-trustee-tally';
  await page.waitForFunction(() => document.getElementById('native-phase').textContent === 'Results ready', undefined,
    { timeout: (durationSeconds + 180) * 1000 });
  assert.ok(Date.now() - startedAt >= durationSeconds * 1000);
  const totals = (await page.locator('#native-result-bars .result-label strong').allTextContents()).map(Number);
  assert.deepEqual(totals, [1, 0, 0]);
  assert.equal(await page.locator('#native-trustee-1').isChecked(), true);
  assert.equal(await page.locator('#native-trustee-3').isChecked(), true);
  evidence.stages.push({ stage, elapsedMs: Date.now() - startedAt, accepted: 1, totals, trustees: [1, 3] });
  evidence.runtimeErrors = runtimeErrors; evidence.offOriginRequests = offOriginRequests;
  assert.equal(runtimeErrors, 0); assert.equal(offOriginRequests, 0);
  evidence.status = 'passed'; console.log(JSON.stringify({ status: 'passed', voters, cpuSlowdown, durationSeconds }));
} catch {
  evidence.status = 'failed'; evidence.failedStage = stage;
  console.error(JSON.stringify({ status: 'failed', stage, voters, cpuSlowdown, durationSeconds })); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  if (evidenceFile) await writeFile(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
}
