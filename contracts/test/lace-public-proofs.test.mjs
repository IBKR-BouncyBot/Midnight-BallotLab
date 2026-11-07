/** Public inspection boundaries. Real Ledger serialization/signatures only;
 * no accepted-transaction fixtures, fabricated proofs, wallet or network calls.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ledger from '@midnightntwrk/ledger-v9';
import { inspectFinalizedPublicTransaction, inspectionPlan, publicInspectionFailureCode,
  verifyPublicUnshieldedSignatures } from '../../scripts/verify-lace-preview-proofs.mjs';
import { PREVIEW_CHAIN_IDENTITY } from '../native/public-testnet.mjs';

const identity = { ...PREVIEW_CHAIN_IDENTITY, protocolVersion: 2001100 };
const address = '1'.repeat(64);
const operation = { ordinal: 1, txId: '00' + '2'.repeat(64), blockHeight: 100, circuit: null };
function indexed(raw = '00') {
  return { __typename: 'RegularTransaction', raw, hash: '3'.repeat(64), protocolVersion: 2001100,
    block: { height: 100, hash: '4'.repeat(64), timestamp: 1794038400000 },
    identifiers: [operation.txId], transactionResult: { status: 'SUCCESS' } };
}
function rejects(fn, code) {
  assert.throws(fn, error => error.message === 'Public transaction inspection failed'
    && publicInspectionFailureCode(error) === code && !Object.hasOwn(error, 'cause'));
}

test('inspection refuses partial, wrong-era, wrong-chain, ambiguous and private-extra records', () => {
  for (const status of ['FAILURE', 'PARTIAL_SUCCESS']) {
    rejects(() => inspectFinalizedPublicTransaction({ ...indexed(), transactionResult: { status } }, operation, address, identity),
      'transaction-not-fully-successful');
  }
  rejects(() => inspectFinalizedPublicTransaction({ ...indexed(), protocolVersion: 1000400 }, operation, address, identity),
    'transaction-era-mismatch');
  rejects(() => inspectFinalizedPublicTransaction(indexed(), { ...operation, blockHeight: 101 }, address, identity),
    'transaction-block-mismatch');
  rejects(() => inspectFinalizedPublicTransaction({ ...indexed(), identifiers: [operation.txId, operation.txId] }, operation, address, identity),
    'transaction-identity-mismatch');
  rejects(() => inspectFinalizedPublicTransaction({ ...indexed(), witness: 'must-not-be-read-or-output' }, operation, address, identity),
    'invalid-public-record');
  assert.throws(() => inspectFinalizedPublicTransaction(indexed(), operation, address,
    { ...identity, genesisHash: '0x' + '5'.repeat(64) }));
});

test('actual ledger-9 unproven bytes cannot be accepted as a finalized proof-bearing transaction', () => {
  const tx = ledger.Transaction.fromParts('preview', undefined, undefined, ledger.Intent.new(new Date('2030-01-01T00:00:00Z')));
  assert.match(tx.identifiers()[0], /^00[0-9a-f]{64}$/);
  const record = indexed(Buffer.from(tx.serialize()).toString('hex'));
  rejects(() => inspectFinalizedPublicTransaction(record, operation, address, identity), 'transaction-deserialization-failed');
  rejects(() => inspectFinalizedPublicTransaction(indexed('zz'), operation, address, identity), 'invalid-transaction-bytes');
});

test('actual finalized no-action serialization cannot stand in for an election or DUST proof', async () => {
  let callbacks = 0;
  const unavailable = () => { callbacks++; throw new Error('No proof callback is allowed in this empty fixture'); };
  const empty = ledger.Transaction.fromParts('preview', undefined, undefined,
    ledger.Intent.new(new Date('2030-01-01T00:00:00Z')));
  // The actual Ledger has nothing to prove in this fixture. No callback
  // produces a proof or pretends to run a constraint check.
  const finalized = (await empty.prove({ lookupKey: unavailable, check: unavailable, prove: unavailable },
    ledger.CostModel.initialCostModel())).bind();
  assert.equal(callbacks, 0);
  const op = { ...operation, txId: finalized.identifiers()[0] };
  const record = { ...indexed(Buffer.from(finalized.serialize()).toString('hex')),
    hash: finalized.transactionHash(), identifiers: finalized.identifiers() };
  rejects(() => inspectFinalizedPublicTransaction(record, op, address, identity), 'wrong-contract-action');
  rejects(() => inspectFinalizedPublicTransaction({ ...record, hash: 'f'.repeat(64) }, op, address, identity),
    'transaction-identity-mismatch');
});

test('actual native unshielded signatures use each matching input and the Ledger intent payload', () => {
  const secret = ledger.sampleSigningKey(); // Ephemeral test-only key, never retained.
  const otherSecret = ledger.sampleSigningKey();
  const owner = ledger.signatureVerifyingKey(secret), otherOwner = ledger.signatureVerifyingKey(otherSecret);
  const intent = ledger.Intent.new(new Date('2030-01-01T00:00:00Z'));
  const inputs = [owner, otherOwner].map((key, index) => ({ value: BigInt(index + 1), owner: key,
    type: '0'.repeat(64), intentHash: (index + 1).toString(16).repeat(64), outputNo: 0 }));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, [], []);
  const payload = intent.signatureData(1);
  const signatures = [secret, otherSecret].map(key => new ledger.SignatureEnabled(ledger.signData(key, payload)));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, [], signatures);
  assert.equal(verifyPublicUnshieldedSignatures(intent, 1), 2);
  rejects(() => verifyPublicUnshieldedSignatures(intent, 2), 'unshielded-signature-mismatch');
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, [], signatures.slice().reverse());
  rejects(() => verifyPublicUnshieldedSignatures(intent, 1), 'unshielded-signature-mismatch');
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(inputs, [], signatures.slice(0, 1));
  rejects(() => verifyPublicUnshieldedSignatures(intent, 1), 'unshielded-signature-mismatch');
});

test('a historical or incomplete report cannot start public transaction inspection', () => {
  const expected = { runId: '123', headSha: 'a'.repeat(40) };
  for (const value of [{}, { schema: 'midnight-ballot-lab/ci-lace-preview-browser/v1', status: 'failed' },
    { status: 'passed', networkId: 'preview', acceptedApplicationTransactions: 9, observedContractProofCompletions: 8 }]) {
    rejects(() => inspectionPlan(value, expected), 'incomplete-or-wrong-chain-report');
  }
  assert.equal(publicInspectionFailureCode(new Error('untrusted private data')), 'public-inspection-failed');
});
