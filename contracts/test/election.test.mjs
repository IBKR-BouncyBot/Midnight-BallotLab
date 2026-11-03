// UNEXECUTED CONTRACT TEST SOURCE. Requires real compiler output + runtime.
// These are emulator assertions, not proof verification or network tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../managed/election/contract/index.js';

const key = n => { const k = new Uint8Array(32); k[31] = n; return k; };
const ADMIN = key(1), ALICE = key(2), BOB = key(3), MALLORY = key(4);
const ID = key(10), MANIFEST = key(11), RECORD = key(12);
const COIN = '0'.repeat(64), OPEN = 2_000_000_000, CLOSE = OPEN + 600;

function fixture() {
  const contract = new Contract({
    administratorSecret: w => [w.privateState, w.privateState.admin],
    voterSecret: w => [w.privateState, w.privateState.voter],
    eligibilityPath: w => [w.privateState, w.privateState.path],
  });
  const privateState = { admin: ADMIN, voter: ALICE };
  const ctor = contract.initialState(
    RT.createConstructorContext(privateState, COIN),
    ID, MANIFEST, pureCircuits.administratorIdentity(ADMIN), BigInt(OPEN), BigInt(CLOSE),
  );
  const address = RT.sampleContractAddress();
  let context = RT.createCircuitContext(address, COIN, ctor.currentContractState, privateState,
    undefined, undefined, OPEN - 100);
  const state = () => ledger(context.currentQueryContext.state);
  const invoke = (name, ...args) => {
    const result = contract.impureCircuits[name](context, ...args);
    context = result.context;
    return result.result;
  };
  // Runtime accepts the current ChargedState for a new simulated block context.
  // The compiler/runtime must validate this API usage before results are claimed.
  const at = time => {
    context = RT.createCircuitContext(address, COIN, context.currentQueryContext.state,
      context.currentPrivateState, undefined, undefined, time);
  };
  const as = patch => { context = { ...context, currentPrivateState: { ...context.currentPrivateState, ...patch } }; };
  const member = secret => pureCircuits.memberIdentity(ID, secret);
  const pathFor = secret => state().members.findPathForLeaf(member(secret));
  return { contract, state, invoke, at, as, member, pathFor };
}

function opened() {
  const f = fixture();
  f.invoke('enroll', f.member(ALICE));
  f.invoke('enroll', f.member(BOB));
  f.as({ path: f.pathFor(ALICE) });
  f.at(OPEN + 10);
  f.invoke('openVoting');
  return f;
}

test('only the administrator can enroll; duplicate members fail', () => {
  const f = fixture();
  f.as({ admin: MALLORY });
  assert.throws(() => f.invoke('enroll', f.member(ALICE)), /administrator required/);
  f.as({ admin: ADMIN });
  f.invoke('enroll', f.member(ALICE));
  assert.throws(() => f.invoke('enroll', f.member(ALICE)), /already enrolled/);
});

test('time window and enrollment freeze are enforced', () => {
  const f = fixture();
  f.invoke('enroll', f.member(ALICE));
  assert.throws(() => f.invoke('openVoting'), /not started/);
  f.at(OPEN);
  assert.throws(() => f.invoke('enroll', f.member(BOB)), /deadline passed/);
  f.invoke('openVoting');
  assert.throws(() => f.invoke('enroll', f.member(BOB)), /frozen/);
  assert.throws(() => f.invoke('closeVoting'), /not ended/);
});

test('accepts one member commitment and exposes only its record/nullifier/receipt', () => {
  const f = opened();
  const receipt = f.invoke('acceptCommitment', RECORD);
  const nul = pureCircuits.voterNullifier(ID, ALICE);
  assert.equal(f.state().accepted, 1n);
  assert.deepEqual(f.state().recordDigests.lookup(0n), RECORD);
  assert.deepEqual(f.state().recordNullifiers.lookup(0n), nul);
  assert.equal(f.state().receipts.member(receipt), true);
  assert.deepEqual(receipt, pureCircuits.receiptDigest(ID, nul, RECORD));
});

test('duplicate voting with a new record still fails', () => {
  const f = opened();
  f.invoke('acceptCommitment', RECORD);
  assert.throws(() => f.invoke('acceptCommitment', key(13)), /already submitted/);
  assert.equal(f.state().accepted, 1n);
});

test('an attacker cannot use another member path', () => {
  const f = opened();
  f.as({ voter: MALLORY });
  assert.throws(() => f.invoke('acceptCommitment', RECORD), /not bound/);
  assert.equal(f.state().accepted, 0n);
});

test('tampering a Merkle sibling invalidates the electorate proof', () => {
  const f = opened();
  const path = structuredClone(f.pathFor(ALICE));
  path.path[0].sibling.field += 1n;
  f.as({ path });
  assert.throws(() => f.invoke('acceptCommitment', RECORD), /unknown electorate root/);
});

test('an early subset root cannot shrink the voter anonymity set', () => {
  const f = fixture();
  f.invoke('enroll', f.member(ALICE));
  const earlyPath = structuredClone(f.pathFor(ALICE));
  f.invoke('enroll', f.member(BOB));
  f.as({ path: earlyPath });
  f.at(OPEN);
  f.invoke('openVoting');
  assert.throws(() => f.invoke('acceptCommitment', RECORD), /unknown electorate root/);
});

test('deadline prevents late submissions before closeVoting is invoked', () => {
  const f = opened();
  f.at(CLOSE);
  assert.throws(() => f.invoke('acceptCommitment', RECORD), /deadline passed/);
  f.invoke('closeVoting');
  assert.equal(f.state().phase, 2n);
  assert.throws(() => f.invoke('openVoting'), /already opened or closed/);
});

test('hash domains separate identity, nullifier, and elections', () => {
  assert.notDeepEqual(pureCircuits.memberIdentity(ID, ALICE), pureCircuits.voterNullifier(ID, ALICE));
  assert.notDeepEqual(pureCircuits.voterNullifier(ID, ALICE), pureCircuits.voterNullifier(key(20), ALICE));
});

test('there is no API capable of publishing an unverified final tally', () => {
  const f = fixture();
  assert.equal(f.contract.impureCircuits.finalize, undefined);
  assert.equal(f.contract.impureCircuits.publishTally, undefined);
});

test('documents the missing ballot proof: an arbitrary nonzero digest is admitted', () => {
  const f = opened();
  f.invoke('acceptCommitment', key(99));
  assert.equal(f.state().accepted, 1n);
  // This test succeeding demonstrates why this contract is NOT a full election.
});
