// Fresh verification uses real generated Compact/WASM. Synthetic fixture records
// are transport fixtures only, not claims of indexer or network execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../../managed/native-election/contract/index.js';
import { nativeWitnesses } from '../adapter.mjs';
import { createNativeEmulator, nativePublicSnapshot, recoverNativeTally } from '../harness.mjs';
import { projectNativePublicLedger } from '../record.mjs';
import { verifyNativeIndexedObservation, verifyNativePublicSnapshot, nativeIndexedObservationErrorMessage } from '../verify-public.mjs';
import { decodeJsonUtf8 } from '../../../src/json.mjs';

const bytes = last => { const value = new Uint8Array(32); value[31] = last; return value; };
const clone = value => JSON.parse(JSON.stringify(value));
const pointJson = value => value.map(String);
const verify = value => verifyNativeIndexedObservation(JSON.stringify(value));
const OPEN = 2_000_000_000, CLOSE = OPEN + 600;
const WARNING = 'An indexer observation is not authenticated chain evidence or a portable native proof package.';
const manifestFor = candidateCount => ({ schema: 'midnight-ballot-lab/election-manifest/v1',
  title: 'Synthetic indexed-format fixture', choices: Array.from({ length: candidateCount }, (_, index) => `Choice ${index + 1}`) });
const hashManifest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
function observationFromProjection(projection, electionManifest) {
  const { schema, execution, network, proofGenerated, ledgerInclusionVerified, warning, ...publicFields } = projection;
  return { schema: 'midnight-ballot-lab/native-indexed-observation/v1', source: 'configured-indexer', networkId: 'undeployed',
    proofPackageIncluded: false, ledgerInclusionIndependentlyVerified: false, warning: WARNING,
    ...publicFields, ...(electionManifest ? { electionManifest } : {}) };
}
async function fixture({ candidateCount = 3, phase = 3, allShares = false } = {}) {
  const electionManifest = manifestFor(candidateCount), electionId = bytes(60 + candidateCount), administratorSecret = bytes(1);
  const emulator = await createNativeEmulator({ electionId, manifestDigest: await hashManifest(electionManifest),
    administratorSecret, setupSecret: 11n, setupSlope: 7n, opensAt: OPEN, closesAt: CLOSE, candidateCount });
  const voters = [bytes(2), bytes(3), bytes(4)];
  for (const voter of voters) await emulator.call('enroll', pureCircuits.memberIdentity(electionId, voter));
  if (phase >= 1) {
    emulator.setTime(OPEN); await emulator.call('openVoting');
    for (const [index, voter] of voters.entries()) {
      emulator.setPrivateState({ voterSecret: voter, selection: BigInt(index % candidateCount),
        ballotRandomness: Array.from({ length: 5 }, (_, lane) => BigInt(index * 10 + lane + 1)),
        eligibilityPath: emulator.readLedger().members.findPathForLeaf(pureCircuits.memberIdentity(electionId, voter)) });
      await emulator.call('castBallot');
    }
    emulator.setPrivateState({});
  }
  if (phase >= 2) { emulator.setTime(CLOSE); await emulator.call('closeVoting'); }
  if (phase === 3) {
    for (const index of allShares ? [1, 2, 3] : [1, 3]) {
      emulator.setPrivateState({ trusteeSecretShare: 11n + BigInt(index) * 7n });
      await emulator.call('submitDecryption', BigInt(index));
    }
    emulator.setPrivateState({});
    await emulator.call('finalize', 1n, 3n, recoverNativeTally(emulator, 1n, 3n));
  }
  return clone(observationFromProjection(nativePublicSnapshot(emulator), electionManifest));
}
const base = await fixture();

test('actual historical Lace download passes fresh offline verification without new network claims', async () => {
  const data = await readFile(new URL('../../../evidence/2026-11-03/lace-wallet/attempt-2/public-indexed-observation.json', import.meta.url));
  const record = JSON.parse(decodeJsonUtf8(data)), checked = await verifyNativeIndexedObservation(decodeJsonUtf8(data));
  assert.equal(checked.scope, 'indexed-observation-consistency'); assert.equal(checked.networkId, 'undeployed');
  assert.equal(checked.contractAddress, record.contractAddress); assert.equal(checked.configurationDigest, record.configurationDigest);
  assert.equal(checked.phase, 3); assert.equal(checked.accepted, 1); assert.deepEqual(checked.totals, [0, 1]);
  assert.equal(checked.manifestIncluded, true); assert.deepEqual(checked.candidates, record.electionManifest.choices);
  for (const field of ['proofVerified', 'eligibilityVerified', 'trusteeContributionsAuthenticated', 'chainInclusionVerified',
    'electionFairnessEstablished', 'networkAuthenticated', 'contractAddressAuthenticated']) assert.equal(checked[field], false);
  assert.equal('snapshot' in checked, false); assert.equal('ballots' in checked, false); assert.equal('execution' in checked, false);
  assert.ok(Object.isFrozen(checked)); assert.ok(Object.isFrozen(checked.totals));
});

test('fresh actual generated records round-trip two through five active choices and all trustee pairs', async () => {
  for (const candidateCount of [2, 3, 4, 5]) {
    const record = candidateCount === 3 ? base : await fixture({ candidateCount });
    const result = await verify(record);
    assert.equal(result.valid, true); assert.equal(result.accepted, 3); assert.equal(result.candidateCount, candidateCount);
    assert.deepEqual(result.totals, record.finalizedTotals.slice(0, candidateCount));
    assert.deepEqual(result.checkedPairs, [[1, 3]]);
  }
  assert.deepEqual((await verify(await fixture({ allShares: true }))).checkedPairs, [[1, 2], [1, 3], [2, 3]]);
});

test('absent manifests keep candidate labels unknown and unfinished records never report a final tally', async () => {
  const noManifest = clone(base); delete noManifest.electionManifest;
  const result = await verify(noManifest);
  assert.equal(result.manifestIncluded, false); assert.equal(result.title, null); assert.equal(result.candidates, null);
  assert.equal(result.checks.manifestDigest, null); assert.equal(result.checks.configurationDigest, true);
  for (const phase of [0, 1, 2]) {
    const unfinished = await verify(await fixture({ phase }));
    assert.equal(unfinished.phase, phase); assert.equal(unfinished.finalized, false); assert.equal(unfinished.totals, null);
    assert.equal(unfinished.checks.thresholdTally, null); assert.deepEqual(unfinished.checkedPairs, []);
  }
});

test('strict JSON rejects duplicate fields, excessive bytes/depth, invalid UTF-8 and execution relabelling', async () => {
  const text = JSON.stringify(base);
  for (const invalid of [text.replace('{"schema":', '{"schema":"duplicate","schema":'),
    ' '.repeat(8 * 1024 * 1024) + text, '['.repeat(17) + '0' + ']'.repeat(17), text.slice(0, -1),
    text.replace('"phase":3', '"phase":3e0'), '\ufeff' + text]) {
    await assert.rejects(verifyNativeIndexedObservation(invalid), /validation failed \(JSON\)/);
  }
  assert.throws(() => decodeJsonUtf8(Uint8Array.from([0xc3, 0x28])), /valid UTF-8/);
  for (const changed of [{ ...base, execution: 'generated-contract-emulator' }, { ...base, privateState: {} },
    { ...base, networkId: 'mainnet' }, { ...base, proofPackageIncluded: true },
    { ...base, ledgerInclusionIndependentlyVerified: true }, { ...base, warning: 'authenticated' },
    { ...base, contractAddress: '00'.repeat(32) }, { ...base, schema: 'midnight-ballot-lab/native-emulator-public/v2' }]) {
    await assert.rejects(verify(changed), /validation failed \(schema\)/);
  }
  await assert.rejects(verifyNativePublicSnapshot(text), /Public snapshot validation failed \(schema\)/);
  const nested = clone(base); nested.ballots[0].voterSecret = 'SYNTHETIC-PRIVATE-FIELD';
  await assert.rejects(verify(nested), /validation failed \(points\)/);
  const nestedShare = clone(base); nestedShare.decryptionShares[0].secretShare = 'SYNTHETIC-PRIVATE-FIELD';
  await assert.rejects(verify(nestedShare), /validation failed \(points\)/);
});

test('optional public election metadata must match the committed digest and active choices exactly', async () => {
  const reordered = clone(base); reordered.electionManifest = Object.fromEntries(Object.entries(reordered.electionManifest).reverse());
  assert.equal((await verify(reordered)).checks.manifestDigest, true);
  for (const electionManifest of [null, { ...base.electionManifest, title: 'Changed title' },
    { ...base.electionManifest, choices: ['First', 'Second'] }, { ...base.electionManifest, choices: ['Same', 'Same', 'Other'] },
    { ...base.electionManifest, privateKey: 'SYNTHETIC-PRIVATE-FIELD' }]) {
    await assert.rejects(verify({ ...base, electionManifest }), /validation failed \(manifest\)/);
  }
});

test('unconfigured real constructor exports receive a fixed actionable code without treating placeholders as verified', async () => {
  const contract = new Contract(nativeWitnesses);
  const initial = await contract.initialState(RT.createConstructorContext({}, '0'.repeat(64)),
    bytes(90), bytes(91), pureCircuits.administratorIdentity(bytes(1)), BigInt(OPEN), BigInt(CLOSE), 3n);
  const record = observationFromProjection(projectNativePublicLedger(ledger(initial.currentContractState.data),
    { contractAddress: RT.sampleContractAddress() }));
  await assert.rejects(verify(record), error => {
    assert.equal(error.code, 'KEYS_NOT_CONFIGURED');
    const message = nativeIndexedObservationErrorMessage(error);
    assert.ok(message.includes('until trustee keys are configured'));
    error.message = 'SYNTHETIC-PRIVATE-ERROR'; assert.equal(nativeIndexedObservationErrorMessage(error), message);
    assert.equal(error.cause, undefined); return true;
  });
  assert.equal(nativeIndexedObservationErrorMessage({ code: 'KEYS_NOT_CONFIGURED', message: 'SYNTHETIC-PRIVATE-ERROR' }), null);
});

test('actual WASM rejects invalid curve, subgroup, noncanonical and incomplete ciphertext points', async () => {
  for (const invalid of [['0', '0'], ['0', RT.maxField().toString()], [(RT.maxField() + 1n).toString(), '1'], ['00', '1'], [0, 1]]) {
    const changed = clone(base); changed.ballots[0].a[0] = invalid;
    await assert.rejects(verify(changed), /validation failed \(points\)/);
  }
  const identity = clone(base); identity.publicKey = ['0', '1'];
  await assert.rejects(verify(identity), /validation failed \(points\)/);
  const incomplete = clone(base); incomplete.ballots[0].b.pop();
  await assert.rejects(verify(incomplete), /validation failed \(points\)/);
});

test('configuration, key relation, ciphertext, receipt, uniqueness and full aggregate tampering all fail', async () => {
  await assert.rejects(verify({ ...base, configurationDigest: '11'.repeat(32) }), /validation failed \(configuration\)/);
  const wrongKey = clone(base); wrongKey.trusteeKeys[0] = pointJson(pureCircuits.nativePublicKey(101n));
  await assert.rejects(verify(wrongKey), /validation failed \(key relations\)/);
  for (const mutate of [record => { record.ballots[0].b[0] = pointJson(pureCircuits.nativePublicKey(102n)); },
    record => { record.ballots[0].receipt = '12'.repeat(32); },
    record => { record.ballots[1] = { ...record.ballots[0], index: 1 }; }]) {
    const changed = clone(base); mutate(changed);
    await assert.rejects(verify(changed), /validation failed \(ballots\)/);
  }
  const aggregate = clone(base); aggregate.aggregateA[0] = pointJson(pureCircuits.nativePublicKey(103n));
  await assert.rejects(verify(aggregate), /validation failed \(aggregate\)/);
});

test('threshold equations and inactive lanes reject altered totals or trustee contributions', async () => {
  const totals = clone(base); totals.finalizedTotals = [3, 0, 0, 0, 0];
  await assert.rejects(verify(totals), /validation failed \(tally\)/);
  const share = clone(base); share.decryptionShares[1].values[0] = pointJson(pureCircuits.nativePublicKey(104n));
  await assert.rejects(verify(share), /validation failed \(tally\)/);
  const inactive = clone(base); inactive.finalizedTotals = [1, 1, 0, 1, 0];
  await assert.rejects(verify(inactive), /validation failed \(schema\)/);
  const missing = clone(base); missing.decryptionShares.pop();
  await assert.rejects(verify(missing), /validation failed \(schema\)/);
});

test('self-consistent replacement shares never become authenticated election or proof evidence', async () => {
  const changed = clone(base); changed.finalizedTotals = [3, 0, 0, 0, 0];
  changed.decryptionShares[0].values = Array.from({ length: 5 }, () => pointJson(pureCircuits.nativePublicKey(0n)));
  changed.decryptionShares[1].values = changed.aggregateB.map((point, lane) => pointJson(pureCircuits.addPoints(
    pureCircuits.nativePublicKey(BigInt(changed.finalizedTotals[lane]) * 2n), pureCircuits.negatePoint(pureCircuits.scalePoint(point.map(BigInt), 2n)))));
  const result = await verify(changed);
  assert.equal(result.valid, true); assert.equal(result.trusteeContributionsAuthenticated, false);
  assert.equal(result.proofVerified, false); assert.equal(result.chainInclusionVerified, false);
  assert.equal(result.electionFairnessEstablished, false);
  assert.ok(result.limitations.some(text => text.includes('replacement record')));
});
