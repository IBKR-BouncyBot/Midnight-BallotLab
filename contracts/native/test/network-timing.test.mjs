// Display labels against actual generated ledger states. Advancing the display
// clock does not execute circuits, generate proofs or submit transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/native-election/contract/index.js';
import { nativeWitnesses } from '../adapter.mjs';
import { createNativeEmulator, nativePublicSnapshot, recoverNativeTally } from '../harness.mjs';
import { describeNetworkElectionTiming } from '../../../src/network-timing.mjs';

const bytes = last => { const value = new Uint8Array(32); value[31] = last; return value; };
const OPEN = 2_000_000_000, CLOSE = OPEN + 600;

test('timing display uses real native lifecycle states without advancing the election', async () => {
  const administratorSecret = bytes(1), voterSecret = bytes(2), electionId = bytes(10);
  const emulator = await createNativeEmulator({ electionId, manifestDigest: bytes(11), administratorSecret,
    setupSecret: 11n, setupSlope: 7n, opensAt: OPEN, closesAt: CLOSE, candidateCount: 2 });
  const inspect = (seconds, kind, remainingSeconds = null) => {
    const before = JSON.stringify(nativePublicSnapshot(emulator));
    const result = describeNetworkElectionTiming(emulator.readLedger(), seconds * 1000);
    assert.equal(result.kind, kind);
    assert.equal(result.remainingSeconds, remainingSeconds);
    assert.equal(JSON.stringify(nativePublicSnapshot(emulator)), before);
    return result;
  };
  inspect(OPEN - 120, 'planned', 120);
  inspect(OPEN, 'awaiting-open', 600);
  assert.equal(emulator.readLedger().phase, 0n);
  assert.equal(emulator.readLedger().accepted, 0n);

  const member = emulator.pureCircuits.memberIdentity(electionId, voterSecret);
  emulator.call('enroll', member);
  emulator.setTime(OPEN); emulator.call('openVoting');
  inspect(OPEN, 'open', 600);
  emulator.setPrivateState({ voterSecret, selection: 1n,
    eligibilityPath: emulator.readLedger().members.findPathForLeaf(member),
    ballotRandomness: [101n, 103n, 107n, 109n, 113n] });
  emulator.call('castBallot');
  assert.equal(emulator.readLedger().accepted, 1n);
  inspect(CLOSE - 1, 'open', 1);
  inspect(CLOSE, 'awaiting-close');
  inspect(CLOSE + 120, 'awaiting-close');
  assert.equal(emulator.readLedger().phase, 1n);

  emulator.setTime(CLOSE); emulator.call('closeVoting');
  inspect(CLOSE, 'closed');
  for (const [index, trusteeSecretShare] of [[1n, 18n], [3n, 32n]]) {
    emulator.setPrivateState({ trusteeSecretShare });
    emulator.call('submitDecryption', index);
  }
  const totals = recoverNativeTally(emulator, 1n, 3n);
  emulator.call('finalize', 1n, 3n, totals);
  inspect(CLOSE, 'finalized');
  inspect(OPEN - 120, 'finalized');
  assert.deepEqual(emulator.readLedger().finalizedTotals, [0n, 1n, 0n, 0n, 0n]);
});

test('unconfigured generated constructor state is not advertised as ready to open', () => {
  const contract = new Contract(nativeWitnesses), coin = '0'.repeat(64);
  const initial = contract.initialState(RT.createConstructorContext({}, coin), bytes(20), bytes(21),
    pureCircuits.administratorIdentity(bytes(1)), BigInt(OPEN), BigInt(CLOSE), 2n);
  const context = RT.createCircuitContext(RT.sampleContractAddress(), coin,
    initial.currentContractState, {}, undefined, undefined, OPEN - 1);
  const state = ledger(context.currentQueryContext.state);
  assert.equal(state.phase, 0n);
  assert.equal(state.keysConfigured, false);
  const before = describeNetworkElectionTiming(state, (OPEN - 120) * 1000);
  assert.equal(before.kind, 'setup-pending');
  assert.equal(before.remainingSeconds, 120);
  const result = describeNetworkElectionTiming(state, OPEN * 1000);
  assert.equal(result.kind, 'setup-expired');
  assert.equal(result.remainingSeconds, null);
  assert.equal(state.keysConfigured, false);
  assert.equal(state.phase, 0n);
});
