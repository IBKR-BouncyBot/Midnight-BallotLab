import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// These are fail-only boundary checks of the exact CI runner source. They do
// not launch a browser, inject a wallet, generate a proof or submit a transaction.
const source = await readFile(new URL('../../scripts/test-lace-preview-browser.mjs', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from); return source.slice(from, to);
}
function checkedFunction(name, next, additions = {}) {
  const context = vm.createContext({ diagnosticMode: true,
    requireThat(value, category) { if (!value) throw Object.assign(new Error('Boundary rejected'), { category }); },
    ...additions });
  vm.runInContext(section(`async function ${name}(`, next) + `\nthis.checked = ${name};`, context);
  return context.checked;
}
for (const [name, next, args, category] of [
  ['publicApi', 'async function approval(', [true], 'fundless-diagnostic-no-balance-call'],
  ['approval', 'async function authenticate(', ['#/prove-midnight-transaction', 100], 'fundless-diagnostic-no-transaction-approval'],
  ['operation', 'async function waitDeadline(', ['Ballot', 'network-cast'], 'fundless-diagnostic-no-application-transaction'],
]) test(`fundless mode rejects ${name} before any browser/API side effect`, async () => {
  let browserTouched = false;
  const forbidden = new Proxy({}, { get() { browserTouched = true; throw Error('Unexpected browser access'); } });
  const fn = checkedFunction(name, next, { app: forbidden, browserContext: forbidden });
  await assert.rejects(fn(...args), error => error.category === category);
  assert.equal(browserTouched, false);
});

test('fundless mode cannot emit funding, transaction journal or election reports', async () => {
  let written = 0;
  const fn = checkedFunction('atomic', 'const DIAGNOSTIC_PUBLIC_FIELDS', {
    writeFile: async () => { written++; }, rename: async () => { written++; },
  });
  for (const filename of ['funding-request.json', 'public-journal.json', 'browser-report.json', 'public-receipt.json']) {
    await assert.rejects(fn(filename, {}), error => error.category === 'fundless-diagnostic-output-boundary');
  }
  assert.equal(written, 0);
});

test('diagnostic public projection excludes credentials, operations and arbitrary fields', async () => {
  const emitted = [];
  const context = vm.createContext({ diagnosticMode: true, canSave: true, proverObserver: undefined, stage: 'fundless-proof-completed', traffic: {},
    report: { schema: 'midnight-ballot-lab/ci-lace-prover-diagnostic/v1', status: 'passed',
      fundingAttempted: false, networkSubmissionAttempted: false, walletDustProofsTested: false,
      password: 'SYNTHETIC-PRIVATE-MARKER', operations: [{ secret: 'SYNTHETIC-PRIVATE-MARKER' }],
      fundingSource: 'not applicable', arbitrary: 'SYNTHETIC-PRIVATE-MARKER' },
    atomic: async (name, value) => emitted.push({ name, value }),
  });
  vm.runInContext(section('const DIAGNOSTIC_PUBLIC_FIELDS', 'async function setStage(') + '\nthis.persist = save;', context);
  await context.persist();
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].name, 'prover-diagnostic-report.json');
  const publicValue = JSON.parse(JSON.stringify(emitted[0].value));
  assert.equal(publicValue.schema, 'midnight-ballot-lab/ci-lace-prover-diagnostic/v1');
  assert.equal(publicValue.fundingAttempted, false);
  assert.equal(publicValue.networkSubmissionAttempted, false);
  assert.equal(publicValue.walletDustProofsTested, false);
  assert.ok(!JSON.stringify(publicValue).includes('SYNTHETIC-PRIVATE-MARKER'));
  for (const key of ['operations', 'password', 'arbitrary', 'fundingSource', 'acceptedApplicationTransactions']) assert.ok(!(key in publicValue));
});
