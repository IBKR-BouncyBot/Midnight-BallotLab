// Requires real generated bindings; fresh execution evidence is recorded separately.
// These assertions execute the real Compact runtime and generated circuits.
// Emulator success is not proof generation, proof verification or deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/native-election/contract/index.js';
import { createNativeEmulator } from '../harness.mjs';

const Q = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const key = n => { const bytes = new Uint8Array(32); bytes[31] = n; return bytes; };
const ADMIN = key(1), ALICE = key(2), BOB = key(3), CAROL = key(4), MALLORY = key(5);
const ID = key(10), MANIFEST = key(11), COIN = '0'.repeat(64);
const OPEN = 2_000_000_000, CLOSE = OPEN + 600;
const SHARES = { 1: 18n, 2: 25n, 3: 32n }; // x=11, slope=7, computed modulo q off circuit.
const ZERO = pureCircuits.nativePublicKey(0n);

// The fixture intentionally bypasses client scalar/choice preflight so negative
// tests exercise constraints inside generated circuits, not a JavaScript guard.
async function fixture({ configured = true, setupSecret = 11n, setupSlope = 7n, candidateCount = 3n } = {}) {
  const witnessCalls = {};
  const witness = name => w => {
    witnessCalls[name] = (witnessCalls[name] ?? 0) + 1;
    return [w.privateState, w.privateState[name]];
  };
  const contract = new Contract(Object.fromEntries([
    'setupSecret', 'setupSlope', 'administratorSecret', 'voterSecret',
    'eligibilityPath', 'selection', 'ballotRandomness', 'trusteeSecretShare',
  ].map(name => [name, witness(name)])));
  const privateState = {
    administratorSecret: ADMIN, setupSecret, setupSlope, voterSecret: ALICE,
    selection: 0n, ballotRandomness: [101n, 103n, 107n, 109n, 113n], trusteeSecretShare: SHARES[1],
  };
  const ctor = await contract.initialState(
    RT.createConstructorContext(privateState, COIN),
    ID, MANIFEST, pureCircuits.administratorIdentity(ADMIN), BigInt(OPEN), BigInt(CLOSE), candidateCount,
  );
  const constructorWitnessCalls = { ...witnessCalls };
  const address = RT.sampleContractAddress();
  let context = RT.createCircuitContext({ circuitId: 'configureKeys', contractAddress: address,
    coinPublicKeyOrZswapState: COIN, contractState: ctor.currentContractState, privateState, time: OPEN - 100 });
  const state = () => ledger(context.callContext.currentQueryContext.state);
  const invoke = async (name, ...args) => {
    const next = RT.createCircuitContext({ circuitId: name, contractAddress: address, coinPublicKeyOrZswapState: COIN,
      contractState: context.callContext.currentQueryContext.state, privateState: context.callContext.currentPrivateState,
      time: Number(context.callContext.currentQueryContext.block.secondsSinceEpoch) });
    const result = await contract.impureCircuits[name](next, ...args);
    context = result.context;
    return result.result; // Do not serialize private context or proofData.
  };
  const at = time => {
    context = RT.createCircuitContext({ circuitId: context.callContext.circuitId, contractAddress: address,
      coinPublicKeyOrZswapState: COIN, contractState: context.callContext.currentQueryContext.state,
      privateState: context.callContext.currentPrivateState, time });
  };
  const as = patch => { context = { ...context, callContext: { ...context.callContext, currentPrivateState: { ...context.callContext.currentPrivateState, ...patch } } }; };
  const member = secret => pureCircuits.memberIdentity(ID, secret);
  const pathFor = secret => state().members.findPathForLeaf(member(secret));
  if (configured) await invoke('configureKeys');
  return { contract, state, invoke, at, as, member, pathFor, constructorWitnessCalls };
}

async function opened(voters = [ALICE, BOB, CAROL], candidateCount = 3n) {
  const f = await fixture({ candidateCount });
  for (const voter of voters) await f.invoke('enroll', f.member(voter));
  f.as({ eligibilityPath: f.pathFor(ALICE) });
  f.at(OPEN + 1);
  await f.invoke('openVoting');
  return f;
}

async function cast(f, voter, choice, randomness) {
  f.as({ voterSecret: voter, eligibilityPath: f.pathFor(voter), selection: choice,
    ballotRandomness: randomness });
  return await f.invoke('castBallot');
}

async function castThree(f) {
  await cast(f, ALICE, 0n, [101n, 103n, 107n, 109n, 113n]);
  await cast(f, BOB, 1n, [109n, 113n, 127n, 131n, 137n]);
  await cast(f, CAROL, 2n, [131n, 137n, 139n, 149n, 151n]);
}

async function close(f) {
  f.at(CLOSE);
  await f.invoke('closeVoting');
}

async function submit(f, index) {
  f.as({ trusteeSecretShare: SHARES[index] });
  await f.invoke('submitDecryption', BigInt(index));
}

test('constructor has no private setup; proved configureKeys is required and single use', async () => {
  const f = await fixture({ configured: false });
  assert.deepEqual(f.constructorWitnessCalls, {});
  assert.equal(f.state().keysConfigured, false);
  assert.deepEqual(f.state().publicKey, ZERO);
  await assert.rejects(async () => await f.invoke('enroll', f.member(ALICE)), /keys not configured/);
  await assert.rejects(async () => await f.invoke('openVoting'), /keys not configured/);
  await assert.rejects(async () => await f.invoke('closeVoting'), /keys not configured/);
  f.as({ administratorSecret: MALLORY });
  await assert.rejects(async () => await f.invoke('configureKeys'), /administrator required/);
  f.as({ administratorSecret: ADMIN });
  await f.invoke('configureKeys');
  assert.equal(f.state().keysConfigured, true);
  assert.deepEqual(f.state().publicKey, pureCircuits.nativePublicKey(11n));
  for (let i = 1; i <= 3; i++) {
    assert.deepEqual(f.state().trusteeKeys[i - 1], pureCircuits.nativePublicKey(SHARES[i]));
  }
  await assert.rejects(async () => await f.invoke('configureKeys'), /already configured/);
  await f.invoke('enroll', f.member(ALICE));
  await assert.rejects(async () => await f.invoke('configureKeys'), /already configured/);
});

test('setup enforces its deadline and nonzero canonical keys and shares', async () => {
  const late = await fixture({ configured: false });
  late.at(OPEN);
  await assert.rejects(async () => await late.invoke('configureKeys'), /deadline passed/);
  for (const setupSecret of [0n, Q, 1n << 252n]) {
    const f = await fixture({ configured: false, setupSecret });
    await assert.rejects(async () => await f.invoke('configureKeys'), /zero private scalar|noncanonical Jubjub scalar|expected value of type JubjubScalar|expected value of type Vector<5, JubjubScalar>/);
    assert.equal(f.state().keysConfigured, false);
  }
  for (const setupSlope of [0n, Q]) {
    const f = await fixture({ configured: false, setupSlope });
    await assert.rejects(async () => await f.invoke('configureKeys'), /zero private scalar|noncanonical Jubjub scalar|expected value of type JubjubScalar|expected value of type Vector<5, JubjubScalar>/);
  }
  // x+i*slope=0 modulo q makes one trustee's share public; reject all three cases.
  for (const index of [1n, 2n, 3n]) {
    const zeroShare = await fixture({ configured: false, setupSecret: 7n * index, setupSlope: Q - 7n });
    await assert.rejects(async () => await zeroShare.invoke('configureKeys'), /identity trustee key/);
  }
});

test('canonical native scalar boundaries use q, not the Compact Field modulus', async () => {
  assert.deepEqual(pureCircuits.addPoints(pureCircuits.nativePublicKey(Q - 1n),
    pureCircuits.nativePublicKey(1n)), ZERO);
  assert.deepEqual(pureCircuits.nativePublicKey(0n), ZERO);
  assert.throws(() => pureCircuits.nativePublicKey(Q), /noncanonical Jubjub scalar/);
  assert.throws(() => pureCircuits.nativePublicKey(Q + 1n), /noncanonical Jubjub scalar/);
  assert.throws(() => pureCircuits.nativePublicKey(1n << 252n), /noncanonical Jubjub scalar/);
});

test('configuration digest binds actual key commitments, administrator, metadata and schedule', async () => {
  const f = await fixture();
  const s = f.state();
  const args = [s.electionId, s.manifestDigest, s.administrator, s.opensAt,
    s.closesAt, s.candidateCount, s.publicKey, s.coefficientKey, s.trusteeKeys];
  assert.deepEqual(s.configurationDigest, pureCircuits.configurationDigestFor(...args));
  for (const [index, replacement] of [[1, key(99)], [2, key(98)], [4, s.closesAt + 1n],
    [5, 2n], [6, pureCircuits.nativePublicKey(12n)]]) {
    const changed = [...args];
    changed[index] = replacement;
    assert.notDeepEqual(s.configurationDigest, pureCircuits.configurationDigestFor(...changed));
  }
});

test('only the administrator enrolls and the frozen electorate cannot change', async () => {
  const f = await fixture();
  f.as({ administratorSecret: MALLORY });
  await assert.rejects(async () => await f.invoke('enroll', f.member(ALICE)), /administrator required/);
  f.as({ administratorSecret: ADMIN });
  await f.invoke('enroll', f.member(ALICE));
  await assert.rejects(async () => await f.invoke('enroll', f.member(ALICE)), /already enrolled/);
  await assert.rejects(async () => await f.invoke('openVoting'), /not started/);
  f.at(OPEN);
  await assert.rejects(async () => await f.invoke('enroll', f.member(BOB)), /deadline passed/);
  await f.invoke('openVoting');
  await assert.rejects(async () => await f.invoke('enroll', f.member(BOB)), /frozen/);
  await assert.rejects(async () => await f.invoke('configureKeys'), /already configured/);
});

test('a ballot stores all native ciphertext coordinates and its configuration-bound receipt', async () => {
  const f = await opened();
  const receipt = await cast(f, ALICE, 1n, [101n, 103n, 107n, 109n, 113n]);
  const s = f.state();
  const a = s.ballotA.lookup(0n), b = s.ballotB.lookup(0n);
  const nul = pureCircuits.voterNullifier(ID, ALICE);
  assert.equal(s.accepted, 1n);
  assert.deepEqual(a, [101n, 103n, 107n, 109n, 113n].map(scalar => pureCircuits.nativePublicKey(scalar)));
  assert.deepEqual(s.aggregateA, a);
  assert.deepEqual(s.aggregateB, b);
  assert.deepEqual(s.nullifiers.lookup(0n), nul);
  assert.deepEqual(s.ballotReceipts.lookup(0n), receipt);
  assert.equal(s.receipts.member(receipt), true);
  assert.deepEqual(receipt, pureCircuits.receiptDigest(ID, s.configurationDigest, nul, a, b));
  assert.notDeepEqual(receipt, pureCircuits.receiptDigest(ID, MANIFEST, nul, a, b));
  for (let candidate = 0; candidate < 5; candidate++) {
    const plaintext = pureCircuits.addPoints(b[candidate],
      pureCircuits.negatePoint(pureCircuits.scalePoint(a[candidate], 11n)));
    assert.deepEqual(plaintext, pureCircuits.nativePublicKey(candidate === 1 ? 1n : 0n));
  }
});

test('native circuit rejects invalid selection and zero, noncanonical or repeated masks', async () => {
  const f = await opened();
  f.as({ selection: 3n });
  await assert.rejects(async () => await f.invoke('castBallot'), /invalid choice/);
  f.as({ selection: 0n });
  const valid = [101n, 103n, 107n, 109n, 113n];
  for (let index = 0; index < 5; index++) {
    for (const invalid of [0n, Q, 1n << 252n]) {
      const ballotRandomness = [...valid]; ballotRandomness[index] = invalid;
      f.as({ ballotRandomness });
      await assert.rejects(async () => await f.invoke('castBallot'), /zero private scalar|noncanonical Jubjub scalar|expected value of type JubjubScalar|expected value of type Vector<5, JubjubScalar>/);
    }
    for (let other = index + 1; other < 5; other++) {
      const ballotRandomness = [...valid]; ballotRandomness[other] = ballotRandomness[index];
      f.as({ ballotRandomness });
      await assert.rejects(async () => await f.invoke('castBallot'), /reused candidate randomness/);
    }
  }
  assert.equal(f.state().accepted, 0n);
});

test('a new ciphertext cannot bypass a previously spent voter nullifier', async () => {
  const f = await opened();
  await cast(f, ALICE, 0n, [101n, 103n, 107n, 109n, 113n]);
  await assert.rejects(async () => await cast(f, ALICE, 2n, [211n, 223n, 227n, 229n, 233n]), /already voted/);
  assert.equal(f.state().accepted, 1n);
});

test('membership path must be bound to the private voter secret', async () => {
  const f = await opened();
  f.as({ voterSecret: MALLORY });
  await assert.rejects(async () => await f.invoke('castBallot'), /not bound to voter secret/);
});

test('an earlier subset electorate root cannot be used after enrollment is frozen', async () => {
  const f = await fixture();
  await f.invoke('enroll', f.member(ALICE));
  const oldPath = structuredClone(f.pathFor(ALICE));
  await f.invoke('enroll', f.member(BOB));
  f.as({ eligibilityPath: oldPath });
  f.at(OPEN);
  await f.invoke('openVoting');
  await assert.rejects(async () => await f.invoke('castBallot'), /unknown electorate root/);
});

test('mutating a Merkle sibling invalidates voter eligibility', async () => {
  const f = await opened();
  const path = structuredClone(f.pathFor(ALICE));
  path.path[0].sibling.field += 1n;
  f.as({ eligibilityPath: path });
  await assert.rejects(async () => await f.invoke('castBallot'), /unknown electorate root/);
});

test('the deadline rejects ballots even before the closing transaction', async () => {
  const f = await opened();
  await assert.rejects(async () => await f.invoke('closeVoting'), /not ended/);
  f.at(CLOSE);
  await assert.rejects(async () => await f.invoke('castBallot'), /deadline passed/);
  await f.invoke('closeVoting');
  assert.equal(f.state().phase, 2n);
  await assert.rejects(async () => await f.invoke('openVoting'), /already opened or closed/);
  await assert.rejects(async () => await f.invoke('castBallot'), /not open/);
});

test('decryption requires a frozen aggregate and knowledge of the registered share', async () => {
  const f = await opened();
  await castThree(f);
  await assert.rejects(async () => await f.invoke('submitDecryption', 1n), /not frozen/);
  await close(f);
  for (const index of [0n, 4n]) await assert.rejects(async () => await f.invoke('submitDecryption', index), /invalid trustee index/);
  f.as({ trusteeSecretShare: 19n });
  await assert.rejects(async () => await f.invoke('submitDecryption', 1n), /wrong trustee secret share/);
  for (const trusteeSecretShare of [0n, Q]) {
    f.as({ trusteeSecretShare });
    await assert.rejects(async () => await f.invoke('submitDecryption', 1n), /zero private scalar|noncanonical Jubjub scalar|expected value of type JubjubScalar|expected value of type Vector<5, JubjubScalar>/);
  }
  await submit(f, 1);
  assert.deepEqual(f.state().decryptionShares.lookup(1n),
    f.state().aggregateA.map(point => pureCircuits.scalePoint(point, SHARES[1])));
  await assert.rejects(async () => await f.invoke('submitDecryption', 1n), /already submitted/);
});

for (const [first, second] of [[1, 2], [1, 3], [2, 3]]) {
  test(`trustees ${first}+${second} finalize the complete three-ballot aggregate`, async () => {
    const f = await opened();
    await castThree(f);
    await close(f);
    const frozen = structuredClone([f.state().aggregateA, f.state().aggregateB]);
    await submit(f, first);
    await assert.rejects(async () => await f.invoke('finalize', BigInt(first), BigInt(second), [1n, 1n, 1n, 0n, 0n]), /two verified trustees/);
    await submit(f, second);
    await assert.rejects(async () => await f.invoke('finalize', BigInt(first), BigInt(second), [2n, 0n, 1n, 0n, 0n]), /incorrect tally/);
    await f.invoke('finalize', BigInt(first), BigInt(second), [1n, 1n, 1n, 0n, 0n]);
    assert.equal(f.state().phase, 3n);
    assert.deepEqual(f.state().finalizedTotals, [1n, 1n, 1n, 0n, 0n]);
    assert.deepEqual([f.state().aggregateA, f.state().aggregateB], frozen);
    await assert.rejects(async () => await f.invoke('finalize', BigInt(first), BigInt(second), [1n, 1n, 1n, 0n, 0n]), /not frozen/);
  });
}

test('finalization rejects invalid pairs, excess counts and wrong count sums', async () => {
  const f = await opened();
  await castThree(f);
  await close(f);
  await submit(f, 1);
  await submit(f, 2);
  for (const [first, second] of [[0n, 2n], [1n, 4n], [2n, 1n], [1n, 1n]]) {
    await assert.rejects(async () => await f.invoke('finalize', first, second, [1n, 1n, 1n, 0n, 0n]), /invalid trustee pair/);
  }
  await assert.rejects(async () => await f.invoke('finalize', 1n, 2n, [4n, 0n, 0n, 0n, 0n]), /exceeds ballot count/);
  // Native scalar arguments must not wrap into a small public Uint32 tally.
  for (const invalid of [1n << 32n, Q - 1n, Q]) {
    await assert.rejects(async () => await f.invoke('finalize', 1n, 2n, [invalid, 0n, 0n, 0n, 0n]));
    assert.equal(f.state().phase, 2n);
  }
  await assert.rejects(async () => await f.invoke('finalize', 1n, 2n, [1n, 0n, 0n, 0n, 0n]), /do not sum/);
  assert.equal(f.state().phase, 2n);
});

test('empty configured elections have valid identity aggregates and zero totals', async () => {
  const f = await fixture();
  await close(f);
  await submit(f, 1);
  await submit(f, 3);
  assert.deepEqual(f.state().decryptionShares.lookup(1n), [ZERO, ZERO, ZERO, ZERO, ZERO]);
  await f.invoke('finalize', 1n, 3n, [0n, 0n, 0n, 0n, 0n]);
  assert.deepEqual(f.state().finalizedTotals, [0n, 0n, 0n, 0n, 0n]);
});

test('valid nonzero ballot randomness may cancel to an identity aggregate', async () => {
  const f = await opened([ALICE, BOB]);
  await cast(f, ALICE, 0n, [101n, 103n, 107n, 109n, 113n]);
  await cast(f, BOB, 1n, [Q - 101n, Q - 103n, Q - 107n, Q - 109n, Q - 113n]);
  assert.deepEqual(f.state().aggregateA, [ZERO, ZERO, ZERO, ZERO, ZERO]);
  await close(f);
  await submit(f, 2);
  await submit(f, 3);
  await f.invoke('finalize', 2n, 3n, [1n, 1n, 0n, 0n, 0n]);
  assert.deepEqual(f.state().finalizedTotals, [1n, 1n, 0n, 0n, 0n]);
});

test('native membership and nullifier hashes are domain and election separated', async () => {
  assert.notDeepEqual(pureCircuits.memberIdentity(ID, ALICE), pureCircuits.voterNullifier(ID, ALICE));
  assert.notDeepEqual(pureCircuits.voterNullifier(ID, ALICE), pureCircuits.voterNullifier(key(20), ALICE));
});

test('candidate count is constructor-bounded and changes the sealed configuration', async () => {
  for (const candidateCount of [0n, 1n, 6n, 255n]) {
    await assert.rejects(async () => await fixture({ candidateCount }), /candidate count must be two to five/);
  }
  const two = await fixture({ candidateCount: 2n }), five = await fixture({ candidateCount: 5n });
  assert.equal(two.state().candidateCount, 2n); assert.equal(five.state().candidateCount, 5n);
  assert.notDeepEqual(two.state().configurationDigest, five.state().configurationDigest);
  assert.equal(two.state().trusteeKeys.length, 3);
  assert.equal(five.state().aggregateA.length, 5);
});

test('explicit emulator initial time is enforced by the real key-setup deadline', async () => {
  const options = { electionId: ID, manifestDigest: MANIFEST, administratorSecret: ADMIN,
    setupSecret: 11n, setupSlope: 7n, opensAt: OPEN, closesAt: CLOSE, candidateCount: 3 };
  await assert.rejects(createNativeEmulator({ ...options, initialTime: OPEN }), /key setup deadline passed/);
  const emulator = await createNativeEmulator({ ...options, initialTime: OPEN - 1 });
  assert.equal(emulator.readLedger().keysConfigured, true);
  emulator.setPrivateState({});
});

test('asynchronous native calls cannot overlap or change their private inputs and clock', async () => {
  const emulator = await createNativeEmulator({ electionId: ID, manifestDigest: MANIFEST, administratorSecret: ADMIN,
    setupSecret: 11n, setupSlope: 7n, opensAt: OPEN, closesAt: CLOSE, candidateCount: 3 });
  const alice = pureCircuits.memberIdentity(ID, ALICE), bob = pureCircuits.memberIdentity(ID, BOB);
  const enrolling = emulator.call('enroll', alice);
  assert.throws(() => emulator.setPrivateState({}), /native circuit is still executing/);
  assert.throws(() => emulator.setTime(OPEN), /native circuit is still executing/);
  await assert.rejects(emulator.call('enroll', bob), /native circuit is still executing/);
  await enrolling;
  assert.equal(emulator.readLedger().enrolled.member(alice), true);
  assert.equal(emulator.readLedger().enrolled.member(bob), false);
  await emulator.call('enroll', bob);
  await assert.rejects(emulator.call('enroll', bob), /already enrolled/);
  emulator.setTime(OPEN);
  await emulator.call('openVoting');
  assert.equal(emulator.readLedger().phase, 1n);
});

for (const candidateCount of [2n, 3n, 4n, 5n]) {
  test(`${candidateCount} active choices preserve five encrypted lanes and zero inactive totals`, async () => {
    const f = await opened([ALICE, BOB, CAROL], candidateCount);
    f.as({ selection: candidateCount });
    await assert.rejects(async () => await f.invoke('castBallot'), /invalid choice/);
    const choices = [0n, candidateCount - 1n, 1n];
    const totals = [0n, 0n, 0n, 0n, 0n];
    for (const [index, voter] of [ALICE, BOB, CAROL].entries()) {
      await cast(f, voter, choices[index], [101n, 103n, 107n, 109n, 113n].map(value => value + BigInt(index * 1000)));
      totals[Number(choices[index])]++;
    }
    const state = f.state(), receipt = state.ballotReceipts.lookup(0n);
    const changed = structuredClone(state.ballotB.lookup(0n));
    changed[4] = pureCircuits.addPoints(changed[4], pureCircuits.nativePublicKey(1n));
    assert.notDeepEqual(receipt, pureCircuits.receiptDigest(ID, state.configurationDigest,
      state.nullifiers.lookup(0n), state.ballotA.lookup(0n), changed));
    await close(f); await submit(f, 1); await submit(f, 3);
    if (candidateCount < 5n) {
      const changedTotals = [...totals]; changedTotals[0]--; changedTotals[Number(candidateCount)]++;
      await assert.rejects(async () => await f.invoke('finalize', 1n, 3n, changedTotals), /inactive candidate total must be zero/);
    }
    await f.invoke('finalize', 1n, 3n, totals);
    assert.deepEqual(f.state().finalizedTotals, totals);
    assert.equal(f.state().phase, 3n);
    for (let index = Number(candidateCount); index < 5; index++) assert.equal(totals[index], 0n);
  });
}
