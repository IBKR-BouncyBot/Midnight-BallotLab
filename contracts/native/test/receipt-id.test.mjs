// Actual generated contract/runtime records. No wallet, mocked cryptography,
// proving or accepted-network claims are made by these public lookup tests.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeEmulator } from '../harness.mjs';
import { findReceiptIdInIndexedNativeLedger } from '../sdk-client.mjs';

const key = value => { const result = new Uint8Array(32); result[31] = value; return result; };
const hex = value => Buffer.from(value).toString('hex');
let state, pure, ids;
before(async () => {
  const administratorSecret = key(1), electionId = key(10), voters = [key(2), key(3)];
  const emulator = await createNativeEmulator({ electionId, manifestDigest: key(11), administratorSecret,
    setupSecret: 11n, setupSlope: 7n, opensAt: 2_000_000_000, closesAt: 2_000_000_600, candidateCount: 3 });
  pure = emulator.pureCircuits;
  for (const voter of voters) await emulator.call('enroll', pure.memberIdentity(electionId, voter));
  emulator.setTime(2_000_000_000); await emulator.call('openVoting');
  for (const [index, voterSecret] of voters.entries()) {
    emulator.setPrivateState({ voterSecret, selection: BigInt(index),
      eligibilityPath: emulator.readLedger().members.findPathForLeaf(pure.memberIdentity(electionId, voterSecret)),
      ballotRandomness: [101n, 103n, 107n, 109n, 113n].map(value => value + BigInt(index * 100)) });
    await emulator.call('castBallot');
  }
  state = emulator.readLedger();
  ids = [0n, 1n].map(index => hex(state.ballotReceipts.lookup(index)));
});

test('receipt ID lookup finds each real generated ballot and normalizes case and surrounding space', async () => {
  for (const [index, id] of ids.entries()) {
    assert.deepEqual(findReceiptIdInIndexedNativeLedger(state, ` \n${id.toUpperCase()}\t `), { index, receipt: id });
  }
});

test('receipt ID lookup rejects malformed, absent, empty-set and duplicate records', async () => {
  for (const input of [null, 12, '', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'a'.repeat(32) + ' ' + 'b'.repeat(32), { receipt: ids[0] }]) {
    assert.throws(() => findReceiptIdInIndexedNativeLedger(state, input), /64-character hexadecimal/);
  }
  assert.throws(() => findReceiptIdInIndexedNativeLedger(state, '0'.repeat(64)), /not found/);
  assert.throws(() => findReceiptIdInIndexedNativeLedger({ ...state, accepted: 0n }, ids[0]), /not found/);
  const duplicated = { ...state, ballotReceipts: { lookup: () => state.ballotReceipts.lookup(0n) } };
  assert.throws(() => findReceiptIdInIndexedNativeLedger(duplicated, ids[0]), /not unique/);
});

test('receipt ID lookup bounds accepted count before reading a supplied index', async () => {
  for (const accepted of [-1n, 1025n, 2n ** 64n, 2, undefined]) {
    const supplied = { ...state, accepted, ballotReceipts: { lookup: () => { throw new Error('Lookup must not happen'); } } };
    assert.throws(() => findReceiptIdInIndexedNativeLedger(supplied, ids[0]), /count exceeds capacity/);
  }
});

test('receipt ID lookup still requires exact generated ciphertext digest and receipt-set membership', async () => {
  const mismatches = [
    { ballotB: { lookup: () => state.ballotB.lookup(1n) } },
    { nullifiers: { lookup: () => state.nullifiers.lookup(1n) } },
    { configurationDigest: key(99) },
    { electionId: key(98) },
    { receipts: { member: () => false } },
    { ballotA: { lookup: index => state.ballotA.lookup(index).map((point, lane) => lane === 0 ? pure.nativePublicKey(999n) : point) } },
  ];
  for (const mismatch of mismatches) {
    assert.throws(() => findReceiptIdInIndexedNativeLedger({ ...state, ...mismatch }, ids[0]), /receipt does not match/);
  }
});
