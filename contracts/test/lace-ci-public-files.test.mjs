/** Public format boundaries only; no wallet, balance or transaction is created. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOfficialAddressCodec, validateFundingRequest, validateCompletedReport } from '../../scripts/ci-lace-preview-public-check.mjs';
import { PREVIEW_CHAIN_IDENTITY } from '../native/public-testnet.mjs';
import { LACE_PROOF_COVERAGE_SOURCE } from '../../scripts/lace-proof-coverage.mjs';
import { validateWalletProofExecution } from '../../scripts/ci-lace-proof-execution.mjs';

const expected = { runId: '123', headSha: 'a'.repeat(40) };
const chainIdentity = { ...PREVIEW_CHAIN_IDENTITY, protocolVersion: 2001100 };
const proofExecution = () => ({
  schema: 'midnight-ballot-lab/lace-proof-entry-observation/v1', source: { ...LACE_PROOF_COVERAGE_SOURCE },
  observed: true, status: 'observed', failureCategory: null, activeOrdinal: null,
  operations: Array.from({ length: 9 }, (_, index) => ({ ordinal: index + 1, entryCalls: 1, matchedFunctions: 1, workerSessions: 1 })),
  functionEntryOnly: true, proofCompletionAttested: false, privateInputsInspected: false, runtimeEvaluationUsed: false, executionPaused: false,
});
const chainCheckpoints = ['before-wallet-creation', 'before-funding-request', 'before-dust-registration',
  ...Array(9).fill('before-application-operation')].map((checkpoint, index) => ({
  checkpoint, checkedAt: '2026-11-07T09:00:00.000Z', ...(index >= 3 ? { operationOrdinal: index - 2 } : {}),
}));
test('funding files require the exact run, Preview and an official canonical address', async () => {
  const codec = await loadOfficialAddressCodec();
  const address = codec.MidnightBech32m.encode('preview', new codec.UnshieldedAddress(Buffer.alloc(32, 1))).asString();
  const record = { schema: 'midnight-ballot-lab/lace-preview-funding-request/v2', networkId: 'preview', ...expected, chainIdentity,
    nonce: 'b'.repeat(64), unshieldedAddress: address, laceVersion: '2.5.1',
    extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk', maximumFundingAtomic: '5000000000' };
  assert.doesNotThrow(() => validateFundingRequest(record, expected, codec));
  for (const change of [{ networkId: 'mainnet' }, { runId: '124' }, { headSha: 'c'.repeat(40) },
    { unshieldedAddress: address.toUpperCase() }, { unshieldedAddress: address.slice(0, -1) + '!' },
    { maximumFundingAtomic: '5000000001' }, { privateKey: 'must-not-be-accepted' }]) {
    assert.throws(() => validateFundingRequest({ ...record, ...change }, expected, codec));
  }
  for (const change of [{ schema: 'midnight-ballot-lab/lace-preview-funding-request/v1' }, { chainIdentity: undefined },
    { chainIdentity: { ...chainIdentity, genesisHash: '0x' + '1'.repeat(64) } },
    { chainIdentity: { ...chainIdentity, protocolVersion: 1000400 } },
    { chainIdentity: { ...chainIdentity, secret: 'must-not-be-accepted' } }]) {
    assert.throws(() => validateFundingRequest({ ...record, ...change }, expected, codec));
  }
  assert.throws(() => validateFundingRequest(record, { ...expected, chainIdentity: { ...chainIdentity, protocolVersion: 2001101 } }, codec));
});

test('completion requires nine accepted operations and preserves verification limits', () => {
  const record = { schema: 'midnight-ballot-lab/ci-lace-preview-browser/v1', status: 'passed', networkId: 'preview', ...expected,
    chainIdentity, chainCheckpoints, laceVersion: '2.5.1', extensionId: 'gafhhkghbfjjkeiendhlofajokpaflmk', transactionsRetried: 0,
    privateArtifactsExported: false, httpProofProviderConfigured: false, hostedOriginTested: false,
    independentChainVerification: false, walletModeApiAttestation: false,
    walletConnected: true, positiveDustObserved: true, publicRecordConsistent: true,
    proverObserverSha256: 'd'.repeat(64),
    walletProofCoverageHelperSha256: 'f'.repeat(64), walletProofExecution: proofExecution(),
    networkModuleAssets: [{ path: 'network-chunk-AB12CD34.mjs', bytes: 100, sha256: 'e'.repeat(64) }],
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
    { walletProofCoverageHelperSha256: undefined }, { walletProofCoverageHelperSha256: 'not-a-hash' },
    { walletProofExecution: undefined }, { walletProofExecution: { ...proofExecution(), observed: false } },
    { networkModuleAssets: undefined }, { networkModuleAssets: [] },
    { networkModuleAssets: [{ path: '../private.txt', bytes: 100, sha256: 'e'.repeat(64) }] },
    { chainIdentity: undefined }, { chainCheckpoints: chainCheckpoints.slice(0, -1) },
    { chainCheckpoints: chainCheckpoints.map((point, index) => index === 7 ? { ...point, operationOrdinal: 8 } : point) },
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

test('proof-entry evidence pins the exact signed method and rejects private or altered projection fields', () => {
  validateWalletProofExecution(proofExecution(), { completed: true });
  for (const change of [
    { source: { ...LACE_PROOF_COVERAGE_SOURCE, startOffset: LACE_PROOF_COVERAGE_SOURCE.startOffset + 1 } },
    { source: { ...LACE_PROOF_COVERAGE_SOURCE, sha256: '0'.repeat(64) } },
    { source: { ...LACE_PROOF_COVERAGE_SOURCE, url: 'https://example.invalid/private?value=do-not-retain' } },
    { source: { ...LACE_PROOF_COVERAGE_SOURCE, sourceText: 'do-not-retain' } },
    { privateInputsInspected: true }, { runtimeEvaluationUsed: true }, { executionPaused: true },
    { proofCompletionAttested: true }, { functionEntryOnly: false }, { witness: 'do-not-retain' },
    { failureCategory: 'arbitrary upstream detail' }, { status: 'proof-completed' },
  ]) assert.throws(() => validateWalletProofExecution({ ...proofExecution(), ...change }), /Public proof-entry evidence validation failed/);
  const getter = proofExecution();
  Object.defineProperty(getter.source, 'sha256', { get() { assert.fail('must not read an accessor'); }, enumerable: true });
  assert.throws(() => validateWalletProofExecution(getter), /Public proof-entry evidence validation failed/);
  const symbol = proofExecution(); symbol[Symbol('private')] = 'do-not-retain';
  assert.throws(() => validateWalletProofExecution(symbol));
});

test('completion requires nine ordered paid-operation windows with actual entry calls', () => {
  for (const operations of [
    proofExecution().operations.slice(0, 8),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, entryCalls: 0 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, ordinal: 4 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, matchedFunctions: 0 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, workerSessions: 0 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, entryCalls: 1_000_001 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, matchedFunctions: 9, workerSessions: 9 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, entryCalls: 1.5 } : value),
    proofExecution().operations.map((value, index) => index === 4 ? { ...value, arguments: ['do-not-retain'] } : value),
  ]) assert.throws(() => validateWalletProofExecution({ ...proofExecution(), operations }, { completed: true }));
  const partial = { ...proofExecution(), observed: false, status: 'armed', operations: [], activeOrdinal: 1 };
  validateWalletProofExecution(partial);
  assert.throws(() => validateWalletProofExecution(partial, { completed: true }));
  validateWalletProofExecution({ ...partial, status: 'failed', failureCategory: 'proof-coverage-command-failed' });
  assert.throws(() => validateWalletProofExecution({ ...partial, activeOrdinal: 2 }));
  assert.throws(() => validateWalletProofExecution({ ...partial, status: 'closed' }));
  const holes = Array(9);
  assert.throws(() => validateWalletProofExecution({ ...proofExecution(), operations: holes }));
});
