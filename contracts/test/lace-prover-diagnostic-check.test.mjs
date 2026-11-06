import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDiagnosticReport, validateDiagnosticReport } from '../../scripts/ci-lace-prover-diagnostic-check.mjs';

const expected = { runId: '123', headSha: 'a'.repeat(40) };
function report() {
  return {
    schema: 'midnight-ballot-lab/ci-lace-prover-diagnostic/v1', status: 'passed',
    execution: 'genuine-disposable-Lace-fundless-contract-proof', networkId: 'preview', ...expected,
    startedAt: '2026-11-06T00:00:00.000Z', finishedAt: '2026-11-06T00:01:00.000Z',
    fundingAttempted: false, walletDustProofsTested: false, networkSubmissionAttempted: false,
    independentProofVerification: false, privateArtifactsExported: false, hostedOriginTested: false,
    walletModeApiAttestation: false, httpProofProviderConfigured: false,
    laceVersion: '2.5.1', extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk',
    apiVersion: '4.1.0-canary.20260819082604-3b622cb',
    extensionArchiveSha256: 'aa6d59550362a3bbcbef343dffd783621150a7971307116bb11fe0d94b754708',
    runnerSha256: 'd'.repeat(64), networkBundleSha256: 'e'.repeat(64), workerSha256: 'f'.repeat(64),
    diagnosticBuildSha256: '1'.repeat(64), proverObserverSha256: '2'.repeat(64),
    walletConnected: true, walletOnDeviceWasmSelectedThroughUi: true,
    contractProof: { circuit: 'openVoting', constraintCheck: 'passed', bytes: 42, sha256: 'b'.repeat(64), elapsedMs: 1000 },
    walletProverObservation: {
      observed: true, status: 'observed', failureCategory: null, targetCounts: { offscreen: 1, worker: 1 },
      path: 'js/bb7c1f073eb0bc071ea5.module.wasm', bytes: 3_413_037,
      sha256: 'f5326f9e869d7795edbe4a80ad1ed7f0e8636178f60c0268ecd4700787612cdb',
      targetKind: 'worker', evidence: 'passive-cdp-resource-response', requestPayloadsInspected: false,
      unrelatedEventsRetained: false, completeNetworkCoverage: false, runtimeEvaluationUsed: false, executionPaused: false,
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
  const partial = { ...failed }; delete partial.contractProof;
  validateDiagnosticReport(partial, expected, false);
  assert.throws(() => validateDiagnosticReport(partial, expected, true));
});
test('fundless boundary rejects funding/submission, wrong identity, private fields and incomplete proofs', () => {
  for (const change of [
    { fundingAttempted: true }, { walletDustProofsTested: true }, { networkSubmissionAttempted: true },
    { httpProofProviderConfigured: true }, { networkId: 'mainnet' }, { headSha: 'c'.repeat(40) },
    { runId: '124' }, { operations: [] }, { password: 'never-publish' },
    { walletProverObservation: { observed: true, witness: 'never-publish' } },
    { walletProverObservation: { ...report().walletProverObservation, sha256: 'c'.repeat(64) } },
    { walletProverObservation: { ...report().walletProverObservation, bytes: 1 } },
    { walletProverObservation: { ...report().walletProverObservation, completeNetworkCoverage: true } },
    { contractProof: { ...report().contractProof, bytes: 0 } },
    { contractProof: { ...report().contractProof, circuit: 'configureKeys' } },
    { contractProof: { ...report().contractProof, preimage: 'never-publish' } },
    { contractProof: { ...report().contractProof, elapsedMs: 20 * 60_000 + 1 } },
  ]) assert.throws(() => validateDiagnosticReport({ ...report(), ...change }, expected, true));
  const getter = report();
  Object.defineProperty(getter, 'status', { get() { throw new Error('Accessor must not run'); } });
  assert.throws(() => validateDiagnosticReport(getter, expected), /Public diagnostic evidence validation failed/);
});
test('transport rejects duplicate JSON, oversized files and invalid UTF-8 without printing values', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(report()));
  assert.equal(decodeDiagnosticReport(bytes, expected, true).status, 'passed');
  for (const invalid of [
    new TextEncoder().encode('{"schema":"x","schema":"y"}'),
    new Uint8Array(512 * 1024 + 1), new Uint8Array([0xc3, 0x28]),
  ]) assert.throws(() => decodeDiagnosticReport(invalid, expected));
});
