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
    walletProverWasm: { observed: true }, acceptedApplicationTransactions: 9, observedContractProofCompletions: 8,
    operations: ['Deployment', 'Key configuration', 'Enrollment', 'Voting opened', 'Ballot',
      'Voting closed', 'Trustee contribution', 'Trustee contribution', 'Tally finalized'].map((operation, index) => ({
      ordinal: index + 1, operation, status: 'indexer-accepted', txId: (index + 1).toString(16).padStart(66, '0'),
      ...(index === 6 ? { trusteeIndex: 1 } : index === 7 ? { trusteeIndex: 3 } : {}),
    })) };
  assert.doesNotThrow(() => validateCompletedReport(record, expected));
  for (const change of [{ status: 'running' }, { transactionsRetried: 1 }, { httpProofProviderConfigured: true },
    { independentChainVerification: true }, { observedContractProofCompletions: 0 },
    { operations: record.operations.slice(0, 8) },
    { operations: [...record.operations.slice(0, 8), { status: 'uncertain' }] }]) {
    assert.throws(() => validateCompletedReport({ ...record, ...change }, expected));
  }
});
