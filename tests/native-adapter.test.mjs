// These tests cover input boundaries and public-data projection only.
// They do NOT execute Compact, an elliptic curve, a proof, or a Midnight node.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JUBJUB_SCALAR_ORDER as Q, requireScalar, requireBytes32,
  createDemoDealer, freshBallotRandomness, randomSecret32,
  nativeWitnesses, pairCoefficients,
} from '../contracts/native/adapter.mjs';
import { projectNativePublicLedger } from '../contracts/native/record.mjs';

test('native adapter only: accepts canonical scalars and rejects unsafe representations', () => {
  assert.equal(requireScalar(1n), 1n);
  assert.equal(requireScalar(Q - 1n), Q - 1n);
  assert.equal(requireScalar(0n, 'identity', { allowZero: true }), 0n);
  for (const value of [0n, -1n, Q, Q + 1n, 1, '1', true]) assert.throws(() => requireScalar(value));
  for (const value of [new Uint8Array(32), new Uint8Array(31), 'a'.repeat(64)]) assert.throws(() => requireBytes32(value));
});

test('native adapter only: dealer shares use the subgroup modulus and nonzero secrets', () => {
  for (let n = 0; n < 12; n++) {
    const dealer = createDemoDealer();
    requireScalar(dealer.setupSecret); requireScalar(dealer.setupSlope);
    assert.deepEqual(dealer.trustees.map(t => t.index), [1n, 2n, 3n]);
    for (const trustee of dealer.trustees) {
      requireScalar(trustee.secretShare);
      assert.equal(trustee.secretShare, (dealer.setupSecret + trustee.index * dealer.setupSlope) % Q);
    }
  }
});

test('native adapter only: each candidate receives a distinct nonzero random scalar', () => {
  const batches = Array.from({ length: 12 }, freshBallotRandomness);
  for (const batch of batches) {
    assert.equal(batch.length, 3);
    assert.equal(new Set(batch).size, 3);
    batch.forEach(value => requireScalar(value));
  }
  requireBytes32(randomSecret32());
});

test('native adapter only: witness callbacks reject missing or malformed private inputs', () => {
  for (const callback of Object.values(nativeWitnesses)) assert.throws(() => callback({ privateState: {} }), /Missing native private input/);
  const privateState = { selection: 2n, ballotRandomness: [1n, 2n, 3n] };
  assert.deepEqual(nativeWitnesses.selection({ privateState }), [privateState, 2n]);
  assert.throws(() => nativeWitnesses.selection({ privateState: { selection: 3n } }), /selection/);
  assert.throws(() => nativeWitnesses.ballotRandomness({ privateState: { ballotRandomness: [1n, 1n, 2n] } }), /distinct/);
  assert.throws(() => nativeWitnesses.ballotRandomness({ privateState: { ballotRandomness: [1n, 2n, Q] } }), /canonical/);
  assert.throws(() => nativeWitnesses.eligibilityPath({ privateState: { eligibilityPath: {} } }), /depth-10/);
});

test('native adapter only: threshold coefficients select exactly the three supported pairs', () => {
  assert.deepEqual(pairCoefficients(1n, 2n), { first: 2n, second: 1n, scale: 1n });
  assert.deepEqual(pairCoefficients(1n, 3n), { first: 3n, second: 1n, scale: 2n });
  assert.deepEqual(pairCoefficients(2n, 3n), { first: 3n, second: 2n, scale: 1n });
  for (const pair of [[1n, 1n], [3n, 1n], [0n, 2n], [2n, 4n]]) assert.throws(() => pairCoefficients(...pair));
});

function publicFixture() {
  const bytes = new Uint8Array(32).fill(7);
  const points = [[0n, 1n], [0n, 1n], [0n, 1n]];
  const entry = value => ({ lookup: () => value });
  return {
    electionId: bytes, manifestDigest: bytes, configurationDigest: bytes, administrator: bytes,
    keysConfigured: true, opensAt: 100n, closesAt: 200n, phase: 3n, accepted: 1n,
    publicKey: [1n, 2n], coefficientKey: [3n, 4n], trusteeKeys: points,
    aggregateA: points, aggregateB: points, finalizedTotals: [1n, 0n, 0n],
    ballotA: entry(points), ballotB: entry(points), nullifiers: entry(bytes), ballotReceipts: entry(bytes),
    decryptionShares: { member: index => index !== 2n, lookup: () => points },
    privateState: { secretKey: 'PRIVATE-MARKER', setupSecret: 99n },
    proofData: { privateWitness: 'PRIVATE-MARKER' },
    trusteeSecretShare: 'PRIVATE-MARKER', randomness: 'PRIVATE-MARKER', selection: 'PRIVATE-MARKER',
  };
}

test('native projection only: public export excludes all private fields and disclaims proof authentication', () => {
  // Deliberately fabricated ledger-shaped input: projection is NOT verification.
  const record = projectNativePublicLedger(publicFixture(), { contractAddress: 'a'.repeat(64) });
  assert.equal(record.schema, 'midnight-ballot-lab/native-emulator-public/v1');
  assert.equal(record.proofGenerated, false);
  assert.equal(record.ledgerInclusionVerified, false);
  assert.equal(record.network, null);
  assert.equal(record.ballots.length, 1);
  assert.equal(record.decryptionShares.length, 2);
  const json = JSON.stringify(record);
  for (const token of ['PRIVATE-MARKER', 'privateState', 'proofData', 'trusteeSecretShare', 'setupSecret', 'randomness', 'selection']) {
    assert(!json.includes(token), `Public projection leaked ${token}`);
  }
});

test('native projection only: invalid address and excessive ballot counts are rejected', () => {
  assert.throws(() => projectNativePublicLedger(publicFixture(), { contractAddress: 'not-an-address' }), /address/);
  for (const accepted of [-1n, 1025n]) {
    assert.throws(() => projectNativePublicLedger({ ...publicFixture(), accepted }, { contractAddress: 'a'.repeat(64) }), /capacity/);
  }
});
