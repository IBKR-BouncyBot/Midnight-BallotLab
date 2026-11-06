import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LACE_PROGRESS_STAGES, projectLaceProgress, progressText, changedProgress } from '../../scripts/ci-lace-preview-progress.mjs';

const expected = { runId: '123', headSha: 'a'.repeat(40) };
const base = () => ({ schema: 'midnight-ballot-lab/ci-lace-preview-browser/v1', networkId: 'preview',
  ...expected, status: 'preparing', currentStage: 'operation-deploy', operations: [] });
const operation = () => ({ ordinal: 1, operation: 'Deployment', status: 'requested', phases: ['preparation-started'] });
const encode = value => new TextEncoder().encode(JSON.stringify(value));

test('progress emits only fixed stages, statuses, ordinals and phases, never other report fields', () => {
  const value = { ...base(), operations: [{ ...operation(), txId: 'untrusted-private-canary' }],
    walletServices: { indexerUri: 'https://untrusted-private-canary.invalid/' }, secret: 'untrusted-private-canary',
    dustRegistration: { status: 'awaiting-wallet-sync', secret: 'untrusted-private-canary' } };
  const projected = projectLaceProgress(value, expected);
  assert.deepEqual(projected, { scope: 'lace-preview-progress', status: 'preparing', stage: 'operation-deploy',
    dust: 'awaiting-wallet-sync', operations: [{ ordinal: 1, status: 'requested', phase: 'preparation-started' }] });
  assert.equal(progressText(encode(value), expected).includes('untrusted-private-canary'), false);
  assert.ok(Object.isFrozen(projected) && Object.isFrozen(projected.operations));
});

test('unknown strings, mixed source context and malformed operation sequences fail with fixed errors', () => {
  const good = { ...base(), operations: [operation()] };
  const changes = [{ currentStage: 'private-canary' }, { status: 'private-canary' }, { runId: '456' },
    { headSha: 'b'.repeat(40) }, { networkId: 'mainnet' }, { schema: 'private-canary' },
    { operations: [{ ...operation(), ordinal: 0 }] }, { operations: [{ ...operation(), ordinal: 2 }] },
    { operations: [{ ...operation(), operation: 'private-canary' }] },
    { operations: [{ ...operation(), status: 'private-canary' }] },
    { operations: [{ ...operation(), phases: ['private-canary'] }] },
    { operations: [{ ...operation(), phases: ['contract-proving', 'contract-proving'] }] },
    { dustRegistration: { status: 'private-canary' } }];
  for (const change of changes) assert.throws(() => progressText(encode({ ...good, ...change }), expected),
    error => error.message === 'Public progress validation failed' && error.cause === undefined);
  assert.throws(() => projectLaceProgress(Object.defineProperty(base(), 'currentStage', {
    get() { throw new Error('private-canary'); },
  }), expected), { message: 'Public progress validation failed' });
});

test('strict transport rejects duplicate fields, oversized text and invalid UTF-8', () => {
  const text = JSON.stringify(base());
  for (const bytes of [new TextEncoder().encode(text.replace('"status":"preparing"', '"status":"preparing","status":"failed"')),
    new Uint8Array(512 * 1024 + 1), Uint8Array.from([0xc3, 0x28])]) {
    assert.throws(() => progressText(bytes, expected), { message: 'Public progress validation failed' });
  }
});

test('only projected changes produce a new progress line', () => {
  const first = progressText(encode(base()), expected);
  assert.equal(changedProgress(first, undefined), first);
  assert.equal(changedProgress(progressText(encode({ ...base(), ignored: 'not-public' }), expected), first), null);
  const changed = progressText(encode({ ...base(), currentStage: 'waiting-for-authorized-test-funding' }), expected);
  assert.equal(changedProgress(changed, first), changed);
});

test('the fixed progress stage list covers every literal stage in the actual runner', async () => {
  const source = await readFile(new URL('../../scripts/test-lace-preview-browser.mjs', import.meta.url), 'utf8');
  const stages = [...source.matchAll(/setStage\('([^']+)'\)/g)].map(match => match[1]);
  stages.push(...[...source.matchAll(/settingsClick\('[^']+', '([^']+)'/g)].map(match => match[1]));
  stages.push(...[...source.matchAll(/waitDeadline\([^,]+, '([^']+)'/g)].map(match => match[1]));
  assert.ok(stages.length >= 30);
  for (const stage of stages) assert.ok(LACE_PROGRESS_STAGES.includes(stage), 'Runner has an unmapped fixed stage');
});
