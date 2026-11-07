// Voting controls against actual generated ledger states and native hashes.
// Local UI flags are tested as flags, never as accepted ledger transitions.
// This suite generates no proofs and performs no wallet or network operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/native-election/contract/index.js';
import { nativeWitnesses } from '../adapter.mjs';
import { createNativeEmulator, nativePublicSnapshot, recoverNativeTally } from '../harness.mjs';
import { describeNetworkVoting } from '../../../src/network-voting.mjs';

const bytes = last => { const value = new Uint8Array(32); value[31] = last; return value; };
const OPEN = 2_000_000_000, CLOSE = OPEN + 600;
const ADMIN = bytes(1), ALICE = bytes(2), BOB = bytes(3), UNKNOWN = bytes(4);
const options = { electionId: bytes(10), manifestDigest: bytes(11), administratorSecret: ADMIN,
  setupSecret: 11n, setupSlope: 7n, opensAt: OPEN, closesAt: CLOSE, candidateCount: 2 };
const connected = { walletConnected: true, contractConnected: true, configurationVerified: true };

function inspect(emulator, voterSecret, seconds, overrides = {}) {
  const state = emulator.readLedger();
  const before = JSON.stringify(nativePublicSnapshot(emulator));
  const member = emulator.pureCircuits.memberIdentity(state.electionId, voterSecret);
  const nullifier = emulator.pureCircuits.voterNullifier(state.electionId, voterSecret);
  const result = describeNetworkVoting({ ...connected, state, voterKeyValid: true,
    voterRegistered: state.enrolled.member(member), voterSpent: state.spent.member(nullifier),
    selectedChoice: '1', nowMilliseconds: seconds * 1000, ...overrides });
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(nativePublicSnapshot(emulator)), before, 'Readiness must not mutate the actual ledger');
  return result;
}

function expectDisabled(result, kind, canChoose = false) {
  assert.equal(result.kind, kind);
  assert.equal(result.canChoose, canChoose);
  assert.equal(result.canCast, false);
}

function prepareBallot(emulator, voterSecret) {
  const state = emulator.readLedger();
  emulator.setPrivateState({ voterSecret, selection: 1n,
    eligibilityPath: state.members.findPathForLeaf(emulator.pureCircuits.memberIdentity(state.electionId, voterSecret)),
    ballotRandomness: [101n, 103n, 107n, 109n, 113n] });
}

test('voting readiness follows real enrollment, opening, accepted nullifier and closing transitions', async () => {
  const emulator = await createNativeEmulator(options);
  for (const voter of [ALICE, BOB]) await emulator.call('enroll', emulator.pureCircuits.memberIdentity(options.electionId, voter));
  expectDisabled(inspect(emulator, ALICE, OPEN - 1), 'scheduled');
  expectDisabled(inspect(emulator, ALICE, OPEN), 'awaiting-open');
  assert.equal(emulator.readLedger().phase, 0n, 'A display clock cannot open voting');
  emulator.setTime(OPEN); await emulator.call('openVoting');
  const ready = inspect(emulator, ALICE, OPEN);
  assert.equal(ready.kind, 'ready'); assert.equal(ready.canChoose, true); assert.equal(ready.canCast, true);
  expectDisabled(inspect(emulator, UNKNOWN, OPEN), 'not-registered');
  prepareBallot(emulator, ALICE); await emulator.call('castBallot');
  assert.equal(emulator.readLedger().accepted, 1n);
  expectDisabled(inspect(emulator, ALICE, OPEN), 'already-voted');
  await assert.rejects(async () => await emulator.call('castBallot'), /already voted/);
  assert.equal(inspect(emulator, BOB, CLOSE - 1).canCast, true);
  expectDisabled(inspect(emulator, BOB, CLOSE), 'deadline-reached');
  assert.equal(emulator.readLedger().phase, 1n, 'A display deadline cannot close voting');
  emulator.setTime(CLOSE); prepareBallot(emulator, BOB);
  await assert.rejects(async () => await emulator.call('castBallot'), /deadline passed/);
  await emulator.call('closeVoting');
  expectDisabled(inspect(emulator, BOB, CLOSE), 'closed');
  for (const [index, trusteeSecretShare] of [[1n, 18n], [3n, 32n]]) {
    emulator.setPrivateState({ trusteeSecretShare }); await emulator.call('submitDecryption', index);
  }
  await emulator.call('finalize', 1n, 3n, recoverNativeTally(emulator, 1n, 3n));
  expectDisabled(inspect(emulator, BOB, CLOSE), 'finalized');
  assert.deepEqual(emulator.readLedger().finalizedTotals, [0n, 1n, 0n, 0n, 0n]);
});

test('local voting flags and missing inputs cannot enable a genuine open native ledger', async () => {
  const emulator = await createNativeEmulator(options);
  await emulator.call('enroll', emulator.pureCircuits.memberIdentity(options.electionId, ALICE));
  emulator.setTime(OPEN); await emulator.call('openVoting');
  for (const [overrides, kind, canChoose] of [
    [{ walletConnected: false }, 'wallet-required'],
    [{ contractConnected: false }, 'election-required'],
    [{ configurationVerified: false }, 'configuration-unverified'],
    [{ state: null }, 'unavailable'],
    [{ busy: true }, 'busy'],
    [{ pendingReceipt: true }, 'pending'],
    [{ voterKeyValid: false, voterRegistered: null, voterSpent: null }, 'key-required'],
    [{ voterRegistered: null, voterSpent: null }, 'unavailable'],
    [{ selectedChoice: '' }, 'choose', true],
    [{ selectedChoice: '2' }, 'choice-invalid', true],
  ]) expectDisabled(inspect(emulator, ALICE, OPEN, overrides), kind, canChoose ?? false);
  expectDisabled(inspect(emulator, ALICE, OPEN - 1), 'clock-mismatch');
  assert.equal(emulator.readLedger().accepted, 0n);
  assert.equal(inspect(emulator, ALICE, OPEN).canCast, true);
});

test('actual unconfigured and empty-electorate states cannot be advertised as ready to vote', async () => {
  const contract = new Contract(nativeWitnesses), coin = '0'.repeat(64);
  const initial = await contract.initialState(RT.createConstructorContext({}, coin), options.electionId, options.manifestDigest,
    pureCircuits.administratorIdentity(ADMIN), BigInt(OPEN), BigInt(CLOSE), 2n);
  const context = RT.createCircuitContext({ circuitId: 'openVoting', contractAddress: RT.sampleContractAddress(),
    coinPublicKeyOrZswapState: coin, contractState: initial.currentContractState, privateState: {}, time: OPEN - 1 });
  const state = ledger(context.callContext.currentQueryContext.state);
  assert.equal(state.keysConfigured, false);
  const describe = seconds => describeNetworkVoting({ ...connected, state, voterKeyValid: true,
    voterRegistered: false, voterSpent: false, selectedChoice: '1', nowMilliseconds: seconds * 1000 });
  expectDisabled(describe(OPEN - 1), 'setup-required');
  expectDisabled(describe(OPEN), 'setup-expired');
  const empty = await createNativeEmulator(options);
  assert.equal(empty.readLedger().enrolled.size(), 0n);
  expectDisabled(inspect(empty, ALICE, OPEN), 'enrollment-missed');
  empty.setTime(OPEN);
  await assert.rejects(async () => await empty.call('openVoting'), /no voters enrolled/);
  assert.equal(empty.readLedger().phase, 0n);
});
