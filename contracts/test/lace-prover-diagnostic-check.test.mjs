import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDiagnosticReport, validateDiagnosticReport, validateProverObservation, validateNetworkModuleAssets } from '../../scripts/ci-lace-prover-diagnostic-check.mjs';
import { PREVIEW_CHAIN_IDENTITY } from '../native/public-testnet.mjs';

const expected = { runId: '123', headSha: 'a'.repeat(40) };
function report() {
  return {
    schema: 'midnight-ballot-lab/ci-lace-prover-diagnostic/v1', status: 'passed',
    execution: 'genuine-disposable-Lace-fundless-contract-proof', networkId: 'preview', ...expected,
    chainIdentity: { ...PREVIEW_CHAIN_IDENTITY, protocolVersion: 2001100 },
    chainCheckpoints: ['before-wallet-creation', 'before-fundless-proof'].map(checkpoint => ({
      checkpoint, checkedAt: '2026-11-07T00:00:00.000Z',
    })),
    startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:01:00.000Z',
    fundingAttempted: false, walletDustProofsTested: false, networkSubmissionAttempted: false,
    independentProofVerification: false, privateArtifactsExported: false, hostedOriginTested: false,
    walletModeApiAttestation: false, httpProofProviderConfigured: false,
    laceVersion: '2.5.1', extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk',
    apiVersion: '4.1.0-canary.20260819082604-3b622cb',
    extensionArchiveSha256: 'aa6d59550362a3bbcbef343dffd783621150a7971307116bb11fe0d94b754708',
    runnerSha256: 'd'.repeat(64), networkBundleSha256: 'e'.repeat(64), workerSha256: 'f'.repeat(64),
    diagnosticBuildSha256: '1'.repeat(64), proverObserverSha256: '2'.repeat(64),
    networkModuleAssets: [{ path: 'network-chunk-AB12CD34.mjs', bytes: 100, sha256: 'e'.repeat(64) }],
    walletConnected: true, walletOnDeviceWasmSelectedThroughUi: true,
    fundlessWalletAvailability: { matchingWalletCount: 1, expectedApi: true },
    fundlessFixtureState: { status: 'passed', stage: 'complete' },
    contractProof: { circuit: 'openVoting', constraintCheck: 'passed', bytes: 42, sha256: 'b'.repeat(64), elapsedMs: 1000 },
    walletProverObservation: {
      observed: true, status: 'observed', failureCategory: null, targetCounts: { offscreen: 1, worker: 1 },
      path: 'js/bb7c1f073eb0bc071ea5.module.wasm', bytes: 3_413_037,
      sha256: 'f5326f9e869d7795edbe4a80ad1ed7f0e8636178f60c0268ecd4700787612cdb',
      targetKind: 'worker', evidence: 'passive-cdp-resource-response', requestPayloadsInspected: false,
      unrelatedEventsRetained: false, completeNetworkCoverage: false, runtimeEvaluationUsed: false, executionPaused: false,
      discovery: { snapshots: 3, refreshLimit: 3600, windowMilliseconds: 1_800_000, classifiedTargets: {
        offscreenExact: 1, offscreenOtherType: 0, workerExact: 1, workerOtherType: 0,
        workerUrlEmpty: 1, extensionBlobWorker: 0, extensionOther: 0, other: 1,
      } },
    }, currentStage: 'fundless-wallet-contract-proof',
  };
}
// These are public-report format fixtures, never wallet or cryptographic substitutes.
test('fundless publication keeps a failure distinct from completed proof/resource evidence', () => {
  validateDiagnosticReport(report(), expected, true);
  const failed = { ...report(), status: 'failed', failureCategory: 'wallet-prover-wasm-not-observed',
    failedStage: 'fundless-wallet-contract-proof', walletProverObservation: {
      ...report().walletProverObservation, status: 'failed', failureCategory: 'observer-command-failed',
    } };
  validateDiagnosticReport(failed, expected, false);
  assert.throws(() => validateDiagnosticReport(failed, expected, true));
  const partial = { ...failed,
    fundlessFixtureState: { status: 'failed', stage: 'connecting', failureCategory: 'wallet-connection-failed' },
    fundlessWalletAvailability: { matchingWalletCount: 0, expectedApi: false } };
  delete partial.contractProof;
  validateDiagnosticReport(partial, expected, false);
  assert.throws(() => validateDiagnosticReport(partial, expected, true));
});
test('fundless boundary rejects funding/submission, wrong identity, private fields and incomplete proofs', () => {
  for (const change of [
    { fundingAttempted: true }, { walletDustProofsTested: true }, { networkSubmissionAttempted: true },
    { httpProofProviderConfigured: true }, { networkId: 'mainnet' }, { headSha: 'c'.repeat(40) },
    { runId: '124' }, { operations: [] }, { password: 'never-publish' },
    { networkModuleAssets: undefined }, { networkModuleAssets: [] },
    { chainIdentity: undefined }, { chainCheckpoints: [] },
    { chainIdentity: { ...report().chainIdentity, genesisHash: '0x' + 'c'.repeat(64) } },
    { chainCheckpoints: [{ checkpoint: 'before-wallet-creation', checkedAt: '2026-11-07T00:00:00.000Z', secret: 'never-publish' }] },
    { walletProverObservation: { observed: true, witness: 'never-publish' } },
    { walletProverObservation: { ...report().walletProverObservation, sha256: 'c'.repeat(64) } },
    { walletProverObservation: { ...report().walletProverObservation, bytes: 1 } },
    { walletProverObservation: { ...report().walletProverObservation, completeNetworkCoverage: true } },
    { fundlessWalletAvailability: { matchingWalletCount: 1, expectedApi: true, text: 'unreviewed' } },
    { fundlessWalletAvailability: { matchingWalletCount: 0, expectedApi: false } },
    { fundlessFixtureState: { status: 'passed', stage: 'unreviewed' } },
    { fundlessFixtureState: { status: 'passed', stage: 'complete', failureCategory: 'unreviewed' } },
    { contractProof: { ...report().contractProof, bytes: 0 } },
    { contractProof: { ...report().contractProof, circuit: 'configureKeys' } },
    { contractProof: { ...report().contractProof, preimage: 'never-publish' } },
    { contractProof: { ...report().contractProof, elapsedMs: 20 * 60_000 + 1 } },
  ]) assert.throws(() => validateDiagnosticReport({ ...report(), ...change }, expected, true));
  const getter = report();
  Object.defineProperty(getter, 'status', { get() { throw new Error('Accessor must not run'); } });
  assert.throws(() => validateDiagnosticReport(getter, expected), /Public diagnostic evidence validation failed/);
});

test('split-module evidence permits only unique bounded public chunk records', () => {
  const item = { path: 'network-chunk-AB12CD34.mjs', bytes: 100, sha256: 'e'.repeat(64) };
  validateNetworkModuleAssets([item]);
  for (const items of [[], [item, item], [{ ...item, path: '../private.txt' }],
    [{ ...item, path: 'https://unreviewed.invalid/chunk.mjs' }], [{ ...item, bytes: 0 }],
    [{ ...item, bytes: 16 * 1024 * 1024 + 1 }], [{ ...item, sha256: 'not-a-hash' }],
    [{ ...item, secret: 'must-not-be-published' }]]) assert.throws(() => validateNetworkModuleAssets(items));
  const getter = { ...item }; Object.defineProperty(getter, 'path', { get() { throw new Error('Accessor must not run'); } });
  assert.throws(() => validateNetworkModuleAssets([getter]), /Public diagnostic evidence validation failed/);
});
test('observer discovery accepts only bounded counts and fixed classifications, never target details', () => {
  const valid = report();
  validateDiagnosticReport(valid, expected, true);
  const discovery = valid.walletProverObservation.discovery;
  for (const invalid of [
    { ...discovery, snapshots: -1 }, { ...discovery, snapshots: 3601 },
    { ...discovery, refreshLimit: 7200 }, { ...discovery, targetId: 'not-public' },
    { ...discovery, windowMilliseconds: 0 }, { ...discovery, windowMilliseconds: 1_800_001 },
    { ...discovery, windowMilliseconds: '1800000' },
    { ...discovery, classifiedTargets: { ...discovery.classifiedTargets, workerUrlEmpty: 257 } },
    { ...discovery, classifiedTargets: { ...discovery.classifiedTargets, workerExact: '1' } },
    { ...discovery, classifiedTargets: { ...discovery.classifiedTargets, url: 'not-public' } },
    { ...discovery, classifiedTargets: { offscreenExact: 1 } },
  ]) assert.throws(() => validateDiagnosticReport({ ...report(), walletProverObservation: {
    ...report().walletProverObservation, discovery: invalid,
  } }, expected, false));
  const missing = report();
  delete missing.walletProverObservation.discovery;
  assert.throws(() => validateDiagnosticReport(missing, expected, true));
  const fullWindow = { ...report().walletProverObservation, discovery: {
    ...discovery, windowMilliseconds: 10_800_000, refreshLimit: 21_600, snapshots: 21_600,
  } };
  assert.throws(() => validateProverObservation(fullWindow, { completed: true }));
  validateProverObservation(fullWindow, { completed: true, maxWindowMilliseconds: 10_800_000 });
  assert.throws(() => validateProverObservation(fullWindow, { completed: true, maxWindowMilliseconds: 10_800_001 }));
  assert.throws(() => validateProverObservation({ ...fullWindow, discovery: {
    ...fullWindow.discovery, snapshots: 21_601,
  } }, { completed: true, maxWindowMilliseconds: 10_800_000 }));
});

test('transport rejects duplicate JSON, oversized files and invalid UTF-8 without printing values', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(report()));
  assert.equal(decodeDiagnosticReport(bytes, expected, true).status, 'passed');
  for (const invalid of [
    new TextEncoder().encode('{"schema":"x","schema":"y"}'),
    new Uint8Array(512 * 1024 + 1), new Uint8Array([0xc3, 0x28]),
  ]) assert.throws(() => decodeDiagnosticReport(invalid, expected));
});
