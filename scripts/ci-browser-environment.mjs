/** CI-only, wallet-free check of the actual headed Chromium environment. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(filename), '..');
const attempt = process.argv[2];
const child = process.argv[3] === '--launch';
const requireContracts = createRequire(join(root, 'contracts/package.json'));
let output, browser, context;
const report = {
  schema: 'midnight-ballot-lab/ci-browser-environment/v1',
  status: 'failed',
  attempt: ['initial', 'after-repair'].includes(attempt) ? attempt : null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  failureCategory: 'invalid-environment',
  headSha: null,
  runId: null,
  nodeVersion: process.version,
  playwrightVersion: null,
  chromiumVersion: null,
  scriptSha256: null,
  missingTools: [],
  hostDependencyValidationEnabled: false,
  headedBrowserLaunched: false,
  blankPageReady: false,
  browserClosed: false,
  blockedNetworkRequests: 0,
  extensionLoaded: false,
  walletOpened: false,
  proofsRequested: false,
  transactionsSubmitted: false,
  profileRetained: false,
};
async function save() {
  report.finishedAt = new Date().toISOString();
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
function stop(category) { report.failureCategory = category; throw new Error('Browser environment check failed'); }

try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux' ||
      !isAbsolute(process.env.RUNNER_TEMP ?? '') || !report.attempt ||
      !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
      !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ID ?? '')) stop('invalid-environment');
  output = join(process.env.RUNNER_TEMP, `browser-environment-${attempt}.json`);
  report.headSha = process.env.GITHUB_SHA;
  report.runId = process.env.GITHUB_RUN_ID;
  report.scriptSha256 = createHash('sha256').update(await readFile(filename)).digest('hex');
  if (['PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS', 'npm_config_playwright_skip_validate_host_requirements',
    'npm_package_config_playwright_skip_validate_host_requirements'].some(key => process.env[key])) {
    stop('dependency-validation-disabled');
  }
  report.hostDependencyValidationEnabled = true;
  report.playwrightVersion = requireContracts('playwright/package.json').version;
  if (report.playwrightVersion !== '1.64.1') stop('unexpected-playwright-version');

  if (!child) {
    report.missingTools = ['xvfb-run', 'xauth'].filter(tool =>
      spawnSync('which', [tool], { stdio: 'ignore', timeout: 5000 }).status !== 0);
    if (report.missingTools.length) stop('display-tools-missing');
    const env = { ...process.env };
    delete env.DEBUG;
    delete env.PWDEBUG;
    report.failureCategory = 'display-or-launch-failed';
    await save();
    const launched = spawnSync('xvfb-run', ['-a', process.execPath, filename, attempt, '--launch'], {
      env, stdio: 'ignore', timeout: 90_000,
    });
    if (launched.status !== 0) {
      // The child retains its finite failure report; never echo raw stderr.
      if (launched.error) { report.failureCategory = 'display-or-launch-timeout'; await save(); }
      process.exitCode = 1;
    } else {
      const actual = JSON.parse(await readFile(output, 'utf8'));
      if (actual.status !== 'passed' || actual.headedBrowserLaunched !== true ||
          actual.blankPageReady !== true || actual.browserClosed !== true ||
          actual.hostDependencyValidationEnabled !== true) stop('launch-report-invalid');
    }
    console.log(JSON.stringify({ scope: 'headed-browser-environment', attempt, status: process.exitCode ? 'failed' : 'passed' }));
  } else {
    if (!process.env.DISPLAY) stop('display-unavailable');
    const { chromium } = requireContracts('playwright');
    report.failureCategory = 'headed-launch-failed';
    browser = await chromium.launch({ headless: false, timeout: 45_000 });
    report.headedBrowserLaunched = true;
    report.chromiumVersion = browser.version();
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route(/.*/, route => { report.blockedNetworkRequests++; return route.abort(); });
    const page = await context.newPage();
    await page.goto('about:blank', { waitUntil: 'load', timeout: 15_000 });
    const ready = await page.evaluate(() => location.href === 'about:blank' && document.readyState === 'complete');
    if (!ready || report.blockedNetworkRequests !== 0) stop('blank-page-check-failed');
    report.blankPageReady = true;
    await context.close(); context = null;
    await browser.close(); browser = null;
    report.browserClosed = true;
    report.status = 'passed'; report.failureCategory = null;
    await save();
  }
} catch {
  process.exitCode = 1;
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await save().catch(() => {});
  if (!child) console.error(JSON.stringify({ scope: 'headed-browser-environment', attempt: report.attempt, status: 'failed', category: report.failureCategory }));
}
