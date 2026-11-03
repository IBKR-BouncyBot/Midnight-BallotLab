// Requires real generated bindings; fresh execution evidence is recorded separately.
// These assertions execute the real Compact runtime and generated circuits.
// Emulator success is not proof generation, proof verification or deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/native-election/contract/index.js';

const Q = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
const key = n => { const bytes = new Uint8Array(32); bytes[31] = n; return bytes; };
const ADMIN = key(1), ALICE = key(2), BOB = key(3), CAROL = key(4), MALLORY = key(5);
const ID = key(10), MANIFEST = key(11), COIN = '0'.repeat(64);
const OPEN = 2_000_000_000, CLOSE = OPEN + 600;
const SHARES = { 1: 18n, 2: 25n, 3: 32n }; // x=11, slope=7, computed modulo q off circuit.
const ZERO = pureCircuits.nativePublicKey(0n);

// The fixture intentionally bypasses client scalar/choice preflight so negative
// tests exercise constraints inside generated circuits, not a JavaScript guard.
function fixture({ configured = true, setupSecret = 11n, setupSlope = 7n } = {}) {
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
    selection: 0n, ballotRandomness: [101n, 103n, 107n], trusteeSecretShare: SHARES[1],
  };
  const ctor = contract.initialState(
    RT.createConstructorContext(privateState, COIN),
    ID, MANIFEST, pureCircuits.administratorIdentity(ADMIN), BigInt(OPEN), BigInt(CLOSE),
  );
  const constructorWitnessCalls = { ...witnessCalls };
  const address = RT.sampleContractAddress();
  let context = RT.createCircuitContext(address, COIN, ctor.currentContractState,
    privateState, undefined, undefined, OPEN - 100);
  const state = () => ledger(context.currentQueryContext.state);
  const invoke = (name, ...args) => {
    const result = contract.impureCircuits[name](context, ...args);
    context = result.context;
    return result.result; // Do not serialize private context or proofData.
  };
  const at = time => {
    context = RT.createCircuitContext(address, COIN, context.currentQueryContext.state,
      context.currentPrivateState, undefined, undefined, time);
  };
  const as = patch => { context = { ...context, currentPrivateState: { ...context.currentPrivateState, ...patch } }; };
  const member = secret => pureCircuits.memberIdentity(ID, secret);
  const pathFor = secret => state().members.findPathForLeaf(member(secret));
  if (configured) invoke('configureKeys');
  return { contract, state, invoke, at, as, member, pathFor, constructorWitnessCalls };
}

function opened(voters = [ALICE, BOB, CAROL]) {
  const f = fixture();
  for (const voter of voters) f.invoke('enroll', f.member(voter));
  f.as({ eligibilityPath: f.pathFor(ALICE) });
  f.at(OPEN + 1);
  f.invoke('openVoting');
  return f;
}

function cast(f, voter, choice, randomness) {
  f.as({ voterSecret: voter, eligibilityPath: f.pathFor(voter), selection: choice,
    ballotRandomness: randomness });
  return f.invoke('castBallot');
}

function castThree(f) {
  cast(f, ALICE, 0n, [101n, 103n, 107n]);
  cast(f, BOB, 1n, [109n, 113n, 127n]);
  cast(f, CAROL, 2n, [131n, 137n, 139n]);
}

function close(f) {
  f.at(CLOSE);
  f.invoke('closeVoting');
}

function submit(f, index) {
  f.as({ trusteeSecretShare: SHARES[index] });
  f.invoke('submitDecryption', BigInt(index));
}

test('constructor has no private setup; proved configureKeys is required and single use', () => {
  const f = fixture({ configured: false });
  assert.deepEqual(f.constructorWitnessCalls, {});
  assert.equal(f.state().keysConfigured, false);
  assert.deepEqual(f.state().publicKey, ZERO);
  assert.throws(() => f.invoke('enroll', f.member(ALICE)), /keys not configured/);
  assert.throws(() => f.invoke('openVoting'), /keys not configured/);
  assert.throws(() => f.invoke('closeVoting'), /keys not configured/);
  f.as({ administratorSecret: MALLORY });
  assert.throws(() => f.invoke('configureKeys'), /administrator required/);
  f.as({ administratorSecret: ADMIN });
  f.invoke('configureKeys');
  assert.equal(f.state().keysConfigured, true);
  assert.deepEqual(f.state().publicKey, pureCircuits.nativePublicKey(11n));
  for (let i = 1; i <= 3; i++) {
    assert.deepEqual(f.state().trusteeKeys[i - 1], pureCircuits.nativePublicKey(SHARES[i]));
  }
  assert.throws(() => f.invoke('configureKeys'), /already configured/);
  f.invoke('enroll', f.member(ALICE));
  assert.throws(() => f.invoke('configureKeys'), /already configured/);
});

test('setup enforces its deadline and nonzero canonical keys and shares', () => {
  const late = fixture({ configured: false });
  late.at(OPEN);
  assert.throws(() => late.invoke('configureKeys'), /deadline passed/);
  for (const setupSecret of [0n, Q, 1n << 252n]) {
    const f = fixture({ configured: false, setupSecret });
    assert.throws(() => f.invoke('configureKeys'), /zero private scalar|noncanonical Jubjub scalar/);
    assert.equal(f.state().keysConfigured, false);
  }
  for (const setupSlope of [0n, Q]) {
    const f = fixture({ configured: false, setupSlope });
    assert.throws(() => f.invoke('configureKeys'), /zero private scalar|noncanonical Jubjub scalar/);
  }
  // x+i*slope=0 modulo q makes one trustee's share public; reject all three cases.
  for (const index of [1n, 2n, 3n]) {
    const zeroShare = fixture({ configured: false, setupSecret: 7n * index, setupSlope: Q - 7n });
    assert.throws(() => zeroShare.invoke('configureKeys'), /identity trustee key/);
  }
});

test('canonical native scalar boundaries use q, not the Compact Field modulus', () => {
  assert.deepEqual(pureCircuits.addPoints(pureCircuits.nativePublicKey(Q - 1n),
    pureCircuits.nativePublicKey(1n)), ZERO);
  assert.deepEqual(pureCircuits.nativePublicKey(0n), ZERO);
  assert.throws(() => pureCircuits.nativePublicKey(Q), /noncanonical Jubjub scalar/);
  assert.throws(() => pureCircuits.nativePublicKey(Q + 1n), /noncanonical Jubjub scalar/);
  assert.throws(() => pureCircuits.nativePublicKey(1n << 252n), /noncanonical Jubjub scalar/);
});

test('configuration digest binds actual key commitments, administrator, metadata and schedule', () => {
  const f = fixture();
  const s = f.state();
  const args = [s.electionId, s.manifestDigest, s.administrator, s.opensAt,
    s.closesAt, s.publicKey, s.coefficientKey, s.trusteeKeys];
  assert.deepEqual(s.configurationDigest, pureCircuits.configurationDigestFor(...args));
  for (const [index, replacement] of [[1, key(99)], [2, key(98)], [4, s.closesAt + 1n],
    [5, pureCircuits.nativePublicKey(12n)]]) {
    const changed = [...args];
    changed[index] = replacement;
    assert.notDeepEqual(s.configurationDigest, pureCircuits.configurationDigestFor(...changed));
  }
});

test('only the administrator enrolls and the frozen electorate cannot change', () => {
  const f = fixture();
  f.as({ administratorSecret: MALLORY });
  assert.throws(() => f.invoke('enroll', f.member(ALICE)), /administrator required/);
  f.as({ administratorSecret: ADMIN });
  f.invoke('enroll', f.member(ALICE));
  assert.throws(() => f.invoke('enroll', f.member(ALICE)), /already enrolled/);
  assert.throws(() => f.invoke('openVoting'), /not started/);
  f.at(OPEN);
  assert.throws(() => f.invoke('enroll', f.member(BOB)), /deadline passed/);
  f.invoke('openVoting');
  assert.throws(() => f.invoke('enroll', f.member(BOB)), /frozen/);
  assert.throws(() => f.invoke('configureKeys'), /already configured/);
});

test('a ballot stores all native ciphertext coordinates and its configuration-bound receipt', () => {
  const f = opened();
  const receipt = cast(f, ALICE, 1n, [101n, 103n, 107n]);
  const s = f.state();
  const a = s.ballotA.lookup(0n), b = s.ballotB.lookup(0n);
  const nul = pureCircuits.voterNullifier(ID, ALICE);
  assert.equal(s.accepted, 1n);
  assert.deepEqual(a, [101n, 103n, 107n].map(scalar => pureCircuits.nativePublicKey(scalar)));
  assert.deepEqual(s.aggregateA, a);
  assert.deepEqual(s.aggregateB, b);
  assert.deepEqual(s.nullifiers.lookup(0n), nul);
  assert.deepEqual(s.ballotReceipts.lookup(0n), receipt);
  assert.equal(s.receipts.member(receipt), true);
  assert.deepEqual(receipt, pureCircuits.receiptDigest(ID, s.configurationDigest, nul, a, b));
  assert.notDeepEqual(receipt, pureCircuits.receiptDigest(ID, MANIFEST, nul, a, b));
  for (let candidate = 0; candidate < 3; candidate++) {
    const plaintext = pureCircuits.addPoints(b[candidate],
      pureCircuits.negatePoint(pureCircuits.scalePoint(a[candidate], 11n)));
    assert.deepEqual(plaintext, pureCircuits.nativePublicKey(candidate === 1 ? 1n : 0n));
  }
});

test('native circuit rejects invalid selection and zero, noncanonical or repeated masks', () => {
  const f = opened();
  f.as({ selection: 3n });
  assert.throws(() => f.invoke('castBallot'), /invalid choice/);
  f.as({ selection: 0n });
  for (const ballotRandomness of [[0n, 103n, 107n], [101n, Q, 107n],
    [101n, 103n, 1n << 252n], [101n, 101n, 107n], [101n, 103n, 101n]]) {
    f.as({ ballotRandomness });
    assert.throws(() => f.invoke('castBallot'), /zero private scalar|noncanonical Jubjub scalar|reused candidate randomness/);
    assert.equal(f.state().accepted, 0n);
  }
});

test('a new ciphertext cannot bypass a previously spent voter nullifier', () => {
  const f = opened();
  cast(f, ALICE, 0n, [101n, 103n, 107n]);
  assert.throws(() => cast(f, ALICE, 2n, [211n, 223n, 227n]), /already voted/);
  assert.equal(f.state().accepted, 1n);
});

test('membership path must be bound to the private voter secret', () => {
  const f = opened();
  f.as({ voterSecret: MALLORY });
  assert.throws(() => f.invoke('castBallot'), /not bound to voter secret/);
});

test('an earlier subset electorate root cannot be used after enrollment is frozen', () => {
  const f = fixture();
  f.invoke('enroll', f.member(ALICE));
  const oldPath = structuredClone(f.pathFor(ALICE));
  f.invoke('enroll', f.member(BOB));
  f.as({ eligibilityPath: oldPath });
  f.at(OPEN);
  f.invoke('openVoting');
  assert.throws(() => f.invoke('castBallot'), /unknown electorate root/);
});

test('mutating a Merkle sibling invalidates voter eligibility', () => {
  const f = opened();
  const path = structuredClone(f.pathFor(ALICE));
  path.path[0].sibling.field += 1n;
  f.as({ eligibilityPath: path });
  assert.throws(() => f.invoke('castBallot'), /unknown electorate root/);
});

test('the deadline rejects ballots even before the closing transaction', () => {
  const f = opened();
  assert.throws(() => f.invoke('closeVoting'), /not ended/);
  f.at(CLOSE);
  assert.throws(() => f.invoke('castBallot'), /deadline passed/);
  f.invoke('closeVoting');
  assert.equal(f.state().phase, 2n);
  assert.throws(() => f.invoke('openVoting'), /already opened or closed/);
  assert.throws(() => f.invoke('castBallot'), /not open/);
});

test('decryption requires a frozen aggregate and knowledge of the registered share', () => {
  const f = opened();
  castThree(f);
  assert.throws(() => f.invoke('submitDecryption', 1n), /not frozen/);
  close(f);
  for (const index of [0n, 4n]) assert.throws(() => f.invoke('submitDecryption', index), /invalid trustee index/);
  f.as({ trusteeSecretShare: 19n });
  assert.throws(() => f.invoke('submitDecryption', 1n), /wrong trustee secret share/);
  for (const trusteeSecretShare of [0n, Q]) {
    f.as({ trusteeSecretShare });
    assert.throws(() => f.invoke('submitDecryption', 1n), /zero private scalar|noncanonical Jubjub scalar/);
  }
  submit(f, 1);
  assert.deepEqual(f.state().decryptionShares.lookup(1n),
    f.state().aggregateA.map(point => pureCircuits.scalePoint(point, SHARES[1])));
  assert.throws(() => f.invoke('submitDecryption', 1n), /already submitted/);
});

for (const [first, second] of [[1, 2], [1, 3], [2, 3]]) {
  test(`trustees ${first}+${second} finalize the complete three-ballot aggregate`, () => {
    const f = opened();
    castThree(f);
    close(f);
    const frozen = structuredClone([f.state().aggregateA, f.state().aggregateB]);
    submit(f, first);
    assert.throws(() => f.invoke('finalize', BigInt(first), BigInt(second), [1n, 1n, 1n]), /two verified trustees/);
    submit(f, second);
    assert.throws(() => f.invoke('finalize', BigInt(first), BigInt(second), [2n, 0n, 1n]), /incorrect tally/);
    f.invoke('finalize', BigInt(first), BigInt(second), [1n, 1n, 1n]);
    assert.equal(f.state().phase, 3n);
    assert.deepEqual(f.state().finalizedTotals, [1n, 1n, 1n]);
    assert.deepEqual([f.state().aggregateA, f.state().aggregateB], frozen);
    assert.throws(() => f.invoke('finalize', BigInt(first), BigInt(second), [1n, 1n, 1n]), /not frozen/);
  });
}

test('finalization rejects invalid pairs, excess counts and wrong count sums', () => {
  const f = opened();
  castThree(f);
  close(f);
  submit(f, 1);
  submit(f, 2);
  for (const [first, second] of [[0n, 2n], [1n, 4n], [2n, 1n], [1n, 1n]]) {
    assert.throws(() => f.invoke('finalize', first, second, [1n, 1n, 1n]), /invalid trustee pair/);
  }
  assert.throws(() => f.invoke('finalize', 1n, 2n, [4n, 0n, 0n]), /exceeds ballot count/);
  assert.throws(() => f.invoke('finalize', 1n, 2n, [1n, 0n, 0n]), /do not sum/);
  assert.equal(f.state().phase, 2n);
});

test('empty configured elections have valid identity aggregates and zero totals', () => {
  const f = fixture();
  close(f);
  submit(f, 1);
  submit(f, 3);
  assert.deepEqual(f.state().decryptionShares.lookup(1n), [ZERO, ZERO, ZERO]);
  f.invoke('finalize', 1n, 3n, [0n, 0n, 0n]);
  assert.deepEqual(f.state().finalizedTotals, [0n, 0n, 0n]);
});

test('valid nonzero ballot randomness may cancel to an identity aggregate', () => {
  const f = opened([ALICE, BOB]);
  cast(f, ALICE, 0n, [101n, 103n, 107n]);
  cast(f, BOB, 1n, [Q - 101n, Q - 103n, Q - 107n]);
  assert.deepEqual(f.state().aggregateA, [ZERO, ZERO, ZERO]);
  close(f);
  submit(f, 2);
  submit(f, 3);
  f.invoke('finalize', 2n, 3n, [1n, 1n, 0n]);
  assert.deepEqual(f.state().finalizedTotals, [1n, 1n, 0n]);
});

test('native membership and nullifier hashes are domain and election separated', () => {
  assert.notDeepEqual(pureCircuits.memberIdentity(ID, ALICE), pureCircuits.voterNullifier(ID, ALICE));
  assert.notDeepEqual(pureCircuits.voterNullifier(ID, ALICE), pureCircuits.voterNullifier(key(20), ALICE));
});
