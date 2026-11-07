// Exercises real compiled Compact pure/impure circuits and the official native WASM.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { pureCircuits } from '../../managed/native-election/contract/index.js';
import { createNativeEmulator, nativePublicSnapshot, recoverNativeTally } from '../harness.mjs';
import { nativeManifestDigest, validateNativePublicPoint, verifyNativePublicSnapshot } from '../verify-public.mjs';

const hex = value => [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
const key = value => { const result = new Uint8Array(32); result[31] = value; return result; };
const pointJson = point => point.map(String);
const clone = value => JSON.parse(JSON.stringify(value));
const verify = (snapshot, options) => verifyNativePublicSnapshot(JSON.stringify(snapshot), options);

async function fixture({ candidateCount = 3, pair = [1, 3], partial = false, allShares = false } = {}) {
  const electionId = key(60 + candidateCount), administratorSecret = key(1);
  const opensAt = 2_000_000_000, closesAt = opensAt + 600;
  const manifest = { schema: 'midnight-ballot-lab/native-demo-manifest/v2', execution: 'emulator',
    electionId: hex(electionId), title: 'Public verification fixture',
    candidates: Array.from({ length: candidateCount }, (_, i) => `Choice ${i + 1}`),
    threshold: 2, capacity: 1024, syntheticVoters: 5, timingMode: 'manual', durationSeconds: 600, opensAt, closesAt };
  const emulator = await createNativeEmulator({ electionId, manifestDigest: await nativeManifestDigest(manifest),
    administratorSecret, setupSecret: 11n, setupSlope: 7n, opensAt, closesAt, candidateCount });
  const voters = Array.from({ length: 5 }, (_, i) => key(i + 2));
  for (const voter of voters) await emulator.call('enroll', pureCircuits.memberIdentity(electionId, voter));
  emulator.setTime(opensAt + 1); await emulator.call('openVoting');
  for (let i = 0; i < voters.length; i++) {
    emulator.setPrivateState({ voterSecret: voters[i], selection: BigInt(i % candidateCount),
      ballotRandomness: Array.from({ length: 5 }, (_, lane) => BigInt(i * 10 + lane + 1)),
      eligibilityPath: emulator.readLedger().members.findPathForLeaf(pureCircuits.memberIdentity(electionId, voters[i])) });
    await emulator.call('castBallot');
  }
  if (!partial) {
    emulator.setPrivateState({}); emulator.setTime(closesAt + 1); await emulator.call('closeVoting');
    for (const index of allShares ? [1, 2, 3] : pair) {
      emulator.setPrivateState({ trusteeSecretShare: 11n + BigInt(index) * 7n });
      await emulator.call('submitDecryption', BigInt(index));
    }
    emulator.setPrivateState({});
    await emulator.call('finalize', ...pair.map(BigInt), recoverNativeTally(emulator, ...pair.map(BigInt)));
  }
  const snapshot = { ...nativePublicSnapshot(emulator), manifest };
  // The verifier receives a transport copy only; this scope retains no emulator reference.
  return clone(snapshot);
}
const base = await fixture();

for (const candidateCount of [2, 3, 4, 5]) {
  test(`fresh public import verifies a real ${candidateCount}-choice native election without private state`, async () => {
    const snapshot = candidateCount === 3 ? clone(base) : await fixture({ candidateCount });
    const result = await verify(snapshot);
    assert.equal(result.valid, true);
    assert.equal(result.finalized, true);
    assert.equal(result.candidateCount, candidateCount);
    assert.equal(result.accepted, 5);
    assert.deepEqual(result.totals, snapshot.finalizedTotals.slice(0, candidateCount));
    assert.deepEqual(result.checkedPairs, [[1, 3]]);
    assert.equal(result.proofVerified, false);
    assert.equal(result.eligibilityVerified, false);
    assert.equal(result.trusteeContributionsAuthenticated, false);
    assert.equal(result.chainInclusionVerified, false);
    assert.equal(result.electionFairnessEstablished, false);
  });
}

test('all three public trustee pairs are checked when all contributions are published', async () => {
  const snapshot = await fixture({ allShares: true });
  assert.deepEqual((await verify(snapshot)).checkedPairs, [[1, 2], [1, 3], [2, 3]]);
  snapshot.decryptionShares[2].values[0] = pointJson(pureCircuits.nativePublicKey(101n));
  await assert.rejects(verify(snapshot), /validation failed \(tally\)/);
});

test('a nonfinalized import verifies its public contents without reporting a tally', async () => {
  const result = await verify(await fixture({ partial: true }));
  assert.equal(result.valid, true);
  assert.equal(result.finalized, false);
  assert.equal(result.totals, null);
  assert.equal(result.checks.thresholdTally, null);
  assert.deepEqual(result.checkedPairs, []);
});

test('receipt checks work against a transport copy in a fresh verifier', async () => {
  const receipt = { schema: 'midnight-ballot-lab/native-emulator-receipt/v1',
    execution: 'generated-contract-emulator', network: null, contractAddress: base.contractAddress,
    electionId: base.electionId, configurationDigest: base.configurationDigest, index: 2,
    receipt: base.ballots[2].receipt, proofGenerated: false, ledgerInclusionVerified: false };
  assert.equal((await verify(clone(base), { receipt })).receiptMatched, true);
  assert.equal((await verify(clone(base), { receipt, expectedConfigurationDigest: base.configurationDigest })).checks.expectedConfiguration, true);
  await assert.rejects(verify(base, { receipt: { ...receipt, index: 1 } }), /validation failed \(receipt\)/);
  await assert.rejects(verify(base, { receipt: { ...receipt, contractAddress: '00'.repeat(32) } }), /validation failed \(receipt\)/);
  await assert.rejects(verify(base, { receipt: { ...receipt, proofGenerated: true } }), /validation failed \(receipt\)/);
  await assert.rejects(verify(base, { receipt: { ...receipt, voterSecret: 'must-not-be-accepted' } }), /validation failed \(receipt\)/);
  await assert.rejects(verify(base, { expectedConfigurationDigest: '00'.repeat(32) }), /validation failed \(configuration\)/);
});

test('manifest digest is deterministic under field reordering and rejects private/ambiguous metadata', async () => {
  const reordered = Object.fromEntries(Object.entries(base.manifest).reverse());
  assert.equal(hex(await nativeManifestDigest(reordered)), base.manifestDigest);
  const changed = clone(base);
  changed.manifest.candidates[0] = 'Different label';
  await assert.rejects(verify(changed), /validation failed \(manifest\)/);
  await assert.rejects(nativeManifestDigest({ ...base.manifest, trusteeSecret: 'not-public' }), /Invalid public record/);
  await assert.rejects(nativeManifestDigest({ ...base.manifest, syntheticVoters: 1025 }), /Invalid public record/);
  await assert.rejects(nativeManifestDigest({ ...base.manifest, timingMode: 'network' }), /Invalid public record/);
  await assert.rejects(nativeManifestDigest({ ...base.manifest, durationSeconds: 601 }), /Invalid public record/);
  await assert.rejects(nativeManifestDigest({ ...base.manifest, timingMode: 'scheduled', durationSeconds: 14,
    closesAt: base.manifest.opensAt + 14 }), /Invalid public record/);
  assert.equal((await nativeManifestDigest({ ...base.manifest, timingMode: 'scheduled', durationSeconds: 15,
    closesAt: base.manifest.opensAt + 15 })).length, 32);
});

test('canonical schema rejects duplicate JSON fields, hidden/private fields and changed execution claims', async () => {
  const text = JSON.stringify(base);
  await assert.rejects(verifyNativePublicSnapshot(text.replace('{"schema":', '{"schema":"duplicate","schema":')), /validation failed \(JSON\)/);
  await assert.rejects(verify({ ...base, privateState: {} }), /validation failed \(schema\)/);
  await assert.rejects(verify({ ...base, proofGenerated: true }), /validation failed \(schema\)/);
  await assert.rejects(verify({ ...base, candidateCount: 6 }), /validation failed \(schema\)/);
  await assert.rejects(verify({ ...base, accepted: 1025 }), /validation failed \(schema\)/);
  for (const field of ['electionId', 'manifestDigest', 'administrator']) {
    await assert.rejects(verify({ ...base, [field]: '00'.repeat(32) }), /validation failed \(schema\)/);
  }
  const nested = clone(base); nested.ballots[0].choice = 1;
  await assert.rejects(verify(nested), /validation failed \(points\)/);
});

test('official WASM point gate rejects off-curve, torsion, noncanonical and forbidden identity points', async () => {
  const generator = pointJson(pureCircuits.nativePublicKey(1n));
  assert.deepEqual(validateNativePublicPoint(generator), generator.map(BigInt));
  assert.deepEqual(validateNativePublicPoint(['0', '1']), [0n, 1n]);
  for (const bad of [['0', '0'], ['0', RT.maxField().toString()], [(RT.maxField() + 1n).toString(), '1'],
    ['00', '1'], ['-1', '1'], [0, 1], ['1e0', '1']]) {
    assert.throws(() => validateNativePublicPoint(bad), /Invalid native public point/);
  }
  assert.throws(() => validateNativePublicPoint(['0', '1'], { nonIdentity: true }), /Invalid native public point/);
});

test('untrusted point types are checked even when a canonical point is already cached', async () => {
  const changed = clone(base);
  changed.aggregateA[0] = ['0', '1'];
  changed.aggregateA[1] = [0, 1];
  await assert.rejects(verify(changed), /validation failed \(points\)/);
  for (const invalidPoint of [['0', '0'], ['0', RT.maxField().toString()]]) {
    const malformed = clone(base);
    malformed.ballots[1].a[0] = invalidPoint;
    await assert.rejects(verify(malformed), /validation failed \(points\)/);
  }
});

test('configuration and registered trustee key relations are independently recomputed', async () => {
  await assert.rejects(verify({ ...base, configurationDigest: '00'.repeat(32) }), /validation failed \(configuration\)/);
  const changed = clone(base);
  changed.trusteeKeys[0] = pointJson(pureCircuits.nativePublicKey(111n));
  await assert.rejects(verify(changed), /validation failed \(key relations\)/);
  changed.publicKey = ['0', '1'];
  await assert.rejects(verify(changed), /validation failed \(points\)/);
});

test('ciphertext receipts, aggregate totals and transcript uniqueness reject tampering', async () => {
  const ciphertext = clone(base);
  ciphertext.ballots[0].b[0] = pointJson(pureCircuits.nativePublicKey(71n));
  await assert.rejects(verify(ciphertext), /validation failed \(ballots\)/);
  const aggregate = clone(base);
  aggregate.aggregateB[0] = pointJson(pureCircuits.nativePublicKey(72n));
  await assert.rejects(verify(aggregate), /validation failed \(aggregate\)/);
  const duplicate = clone(base);
  duplicate.ballots[1] = { ...duplicate.ballots[0], index: 1 };
  await assert.rejects(verify(duplicate), /validation failed \(ballots\)/);
  const changedTotal = clone(base);
  changedTotal.finalizedTotals = [1, 3, 1, 0, 0];
  await assert.rejects(verify(changedTotal), /validation failed \(tally\)/);
  const inactive = clone(base);
  inactive.finalizedTotals = [1, 2, 1, 1, 0];
  await assert.rejects(verify(inactive), /validation failed \(schema\)/);
});

test('self-consistent substituted contributions do not become authenticated proofs or fairness', async () => {
  const changed = clone(base);
  changed.finalizedTotals = [5, 0, 0, 0, 0];
  // Public algebra can construct mutually consistent fake contributions. This
  // deliberately demonstrates the verifier's evidence limit without private keys.
  const identity = pureCircuits.nativePublicKey(0n);
  changed.decryptionShares[0].values = Array.from({ length: 5 }, () => pointJson(identity));
  changed.decryptionShares[1].values = changed.aggregateB.map((point, lane) => pointJson(
    pureCircuits.addPoints(pureCircuits.nativePublicKey(BigInt(changed.finalizedTotals[lane]) * 2n),
      pureCircuits.negatePoint(pureCircuits.scalePoint(point.map(BigInt), 2n)))));
  const result = await verify(changed);
  assert.equal(result.valid, true);
  assert.equal(result.trusteeContributionsAuthenticated, false);
  assert.equal(result.proofVerified, false);
  assert.equal(result.electionFairnessEstablished, false);
  assert.ok(result.limitations.some(value => value.includes('replacement record')));
});

