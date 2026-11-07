/** Public format boundaries only; no wallet, balance or transaction is created. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfficialAddressCodec, validateFundingRequest, validateCompletedReport } from '../../scripts/ci-lace-preview-public-check.mjs';

const expected = { runId: '123', headSha: 'a'.repeat(40) };
test('funding files require the exact run, Preview and an official canonical address', async () => {
  const codec = await loadOfficialAddressCodec();
  const address = codec.MidnightBech32m.encode('preview', new codec.UnshieldedAddress(Buffer.alloc(32, 1))).asString();
  const record = { schema: 'midnight-ballot-lab/lace-preview-funding-request/v1', networkId: 'preview', ...expected,
    nonce: 'b'.repeat(64), unshieldedAddress: address, laceVersion: '2.5.1',
    extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk', maximumFundingAtomic: '5000000000' };
  assert.doesNotThrow(() => validateFundingRequest(record, expected, codec));
  for (const change of [{ networkId: 'mainnet' }, { runId: '124' }, { headSha: 'c'.repeat(40) },
    { unshieldedAddress: address.toUpperCase() }, { unshieldedAddress: address.slice(0, -1) + '!' },
    { maximumFundingAtomic: '5000000001' }, { privateKey: 'must-not-be-accepted' }]) {
    assert.throws(() => validateFundingRequest({ ...record, ...change }, expected, codec));
  }
});

test('completion requires nine accepted operations and preserves verification limits', () => {
  const record = { schema: 'midnight-ballot-lab/ci-lace-preview-browser/v1', status: 'passed', networkId: 'preview', ...expected,
    laceVersion: '2.5.1', extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk', transactionsRetried: 0,
    privateArtifactsExported: false, httpProofProviderConfigured: false, hostedOriginTested: false,
    independentChainVerification: false, walletModeApiAttestation: false,
    walletConnected: true, positiveDustObserved: true, publicRecordConsistent: true,
    proverObserverSha256: 'd'.repeat(64),
    walletProverObservation: {
      observed: true, status: 'observed', failureCategory: null, targetCounts: { offscreen: 1, worker: 1 },
      path: 'js/bb7c1f073eb0bc071ea5.module.wasm', bytes: 3_413_037,
      sha256: 'f5326f9e869d7795edbe4a80ad1ed7f0e8636178f60c0268ecd4700787612cdb',
      targetKind: 'worker', evidence: 'passive-cdp-resource-response', requestPayloadsInspected: false,
      unrelatedEventsRetained: false, completeNetworkCoverage: false, runtimeEvaluationUsed: false, executionPaused: false,
      discovery: { snapshots: 21_600, refreshLimit: 21_600, windowMilliseconds: 10_800_000, classifiedTargets: {
        offscreenExact: 1, offscreenOtherType: 0, workerExact: 1, workerOtherType: 0,
        workerUrlEmpty: 0, extensionBlobWorker: 0, extensionOther: 0, other: 0,
      } },
    }, acceptedApplicationTransactions: 9, observedContractProofCompletions: 8,
    operations: ['Deployment', 'Key configuration', 'Enrollment', 'Voting opened', 'Ballot',
      'Voting closed', 'Trustee contribution', 'Trustee contribution', 'Tally finalized'].map((operation, index) => ({
      ordinal: index + 1, operation, status: 'indexer-accepted', txId: (index + 1).toString(16).padStart(66, '0'),
      ...(index === 6 ? { trusteeIndex: 1 } : index === 7 ? { trusteeIndex: 3 } : {}),
    })) };
  assert.doesNotThrow(() => validateCompletedReport(record, expected));
  for (const change of [{ status: 'running' }, { transactionsRetried: 1 }, { httpProofProviderConfigured: true },
    { independentChainVerification: true }, { observedContractProofCompletions: 0 },
    { proverObserverSha256: undefined }, { proverObserverSha256: 'not-a-hash' },
    { walletProverWasm: { observed: true }, walletProverObservation: undefined },
    { walletProverObservation: { ...record.walletProverObservation, sha256: 'a'.repeat(64) } },
    { walletProverObservation: { ...record.walletProverObservation, bytes: 1 } },
    { walletProverObservation: { ...record.walletProverObservation, status: 'failed', failureCategory: 'observer-command-failed' } },
    { walletProverObservation: { ...record.walletProverObservation, discovery: {
      ...record.walletProverObservation.discovery, windowMilliseconds: 10_800_001,
    } } },
    { operations: record.operations.slice(0, 8) },
    { operations: [...record.operations.slice(0, 8), { status: 'uncertain' }] }]) {
    assert.throws(() => validateCompletedReport({ ...record, ...change }, expected));
  }
});
