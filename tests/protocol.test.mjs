import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import {
  setupElection, encryptBallot, verifyBallot, aggregateBallots,
  createDecryptionShare, finalizeElection, verifyElectionRecord,
  hashManifest, hashRecord, receiptForBallot, verifyReceipt,
} from '../src/protocol.mjs';
import {
  G, mod, pow, hex, element, scalar, hash, sign, randomScalar, proveBit,
} from '../src/crypto.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const ONE = '1'.padStart(512, '0');
const TWO = '2'.padStart(512, '0');
const ZERO = '0'.repeat(512);
const bumpHex = value => (BigInt(`0x${value}`) + 1n).toString(16).padStart(value.length, '0');
let fixture;

before(async () => {
  const setup = await setupElection({
    id: 'adversarial-tests-election-v1',
    title: 'Synthetic election for protocol tests',
    candidates: ['Option A', 'Option B', 'Option C'],
    maxBallots: 10,
    voterCount: 6,
  });
  const ballots = [];
  for (const [i, choice] of [0, 1, 2, 2].entries()) {
    ballots.push(await encryptBallot(setup.manifest, choice, setup.credentials[i]));
  }
  const shares = await Promise.all(setup.trustees.map(trustee =>
    createDecryptionShare(setup.manifest, ballots, trustee)));
  const record = await finalizeElection(setup.manifest, ballots, shares.slice(0, 2));
  fixture = { ...setup, ballots, shares, record };
});

async function invalidRecord(record, options) {
  const result = await verifyElectionRecord(record, options);
  assert.equal(result.valid, false, 'tampered/malformed public record must fail verification');
  assert.ok(result.errors?.length > 0 || result.checks?.some(c => !c.valid), 'failure needs diagnostic evidence');
}

async function invalidBallot(ballot, manifest = fixture.manifest) {
  const result = await verifyBallot(manifest, ballot);
  assert.equal(result.valid, false, 'tampered/malformed ballot must fail verification');
}

/** An enrolled attacker can sign arbitrary payloads; proofs must still be enforced. */
async function authorizeChangedBallot(ballot, credential = fixture.credentials[0]) {
  const { signature: ignoredSignature, id: ignoredId, ...body } = ballot;
  const signature = await sign(await hash('signed-ballot', body),
    element(credential.publicKey), scalar(credential.secretKey));
  const signed = { ...body, signature };
  return { ...signed, id: await hash('ballot-receipt', signed) };
}

async function maliciousBitVector(bits) {
  const body = copy(fixture.ballots[0]);
  const context = {
    electionHash: body.electionHash,
    nullifier: body.nullifier,
    voterPublicKey: body.voterPublicKey,
  };
  const y = element(fixture.manifest.keyCommitments[0]);
  body.ciphertexts = [];
  body.bitProofs = [];
  for (const [candidateIndex, bit] of bits.entries()) {
    const r = randomScalar(true), a = pow(G, r), b = mod(pow(y, r) * pow(G, BigInt(bit)));
    body.ciphertexts.push({ a: hex(a), b: hex(b) });
    body.bitProofs.push(await proveBit({ ...context, candidateIndex }, y, a, b, bit, r));
  }
  // The attacker cannot produce a correct sum-one proof for 0 or 2 selections.
  // Reuse another ballot's proof, while signing the entire new malicious payload.
  return authorizeChangedBallot(body);
}

test('independently verifies all four ballots and exact public totals with external digest checks', async () => {
  const result = await verifyElectionRecord(copy(fixture.record), {
    expectedManifestHash: await hashManifest(fixture.manifest),
    expectedRecordHash: await hashRecord(fixture.record),
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.tally, [1, 1, 2]);
  assert.equal(result.ballotCount, 4);
  assert.ok(result.checks.length >= 3);
  assert.ok(result.checks.every(check => check.valid));
});

test('internally valid record without an external digest does not claim authenticated origin', async () => {
  const result = await verifyElectionRecord(fixture.record);
  assert.equal(result.valid, true);
  assert.equal(result.anchored, false);
});

test('each of the three two-trustee quorums decrypts the same totals', async () => {
  for (const pair of [[0, 1], [0, 2], [1, 2]]) {
    const record = await finalizeElection(fixture.manifest, fixture.ballots, pair.map(i => fixture.shares[i]));
    const result = await verifyElectionRecord(record);
    assert.equal(result.valid, true);
    assert.deepEqual(result.tally, [1, 1, 2]);
  }
});

test('all three valid trustee shares also reconstruct the same tally', async () => {
  const record = await finalizeElection(fixture.manifest, fixture.ballots, fixture.shares);
  const result = await verifyElectionRecord(record);
  assert.equal(result.valid, true);
  assert.deepEqual(result.tally, [1, 1, 2]);
});

test('randomized encryption changes ciphertext and receipt while retaining credential nullifier', async () => {
  const original = fixture.ballots[0];
  const repeated = await encryptBallot(fixture.manifest, 0, fixture.credentials[0]);
  assert.notDeepEqual(original.ciphertexts, repeated.ciphertexts);
  assert.notEqual(original.id, repeated.id);
  assert.equal(original.nullifier, repeated.nullifier);
  assert.equal((await verifyBallot(fixture.manifest, repeated)).valid, true);
});

test('duplicate ballot or reused credential cannot contribute twice', async () => {
  await assert.rejects(() => aggregateBallots(fixture.manifest, [fixture.ballots[0], fixture.ballots[0]]));
  const repeated = await encryptBallot(fixture.manifest, 2, fixture.credentials[0]);
  await assert.rejects(() => aggregateBallots(fixture.manifest, [fixture.ballots[0], repeated]));
});

test('one trustee is insufficient and duplicate shares cannot satisfy threshold', async () => {
  await assert.rejects(() => finalizeElection(fixture.manifest, fixture.ballots, [fixture.shares[0]]));
  await assert.rejects(() => finalizeElection(fixture.manifest, fixture.ballots, [fixture.shares[0], fixture.shares[0]]));
});

test('every trustee decryption-share value and proof is checked', async () => {
  for (const alter of [
    share => { share.values[0].value = TWO; },
    share => { share.values[0].proof.c = bumpHex(share.values[0].proof.c); },
    share => { share.values[0].proof.z = bumpHex(share.values[0].proof.z); },
    share => { share.trusteeIndex = 99; },
    share => { share.values.pop(); },
    share => { share.ballotSetHash = '0'.repeat(64); },
  ]) {
    const changed = copy(fixture.record);
    alter(changed.shares[0]);
    await invalidRecord(changed);
  }
});

test('decryption shares cannot be reused for a different accepted ballot set', async () => {
  await assert.rejects(() => finalizeElection(fixture.manifest, fixture.ballots.slice(0, 3), fixture.shares.slice(0, 2)));
});

test('receipt confirms final inclusion without containing selection or signing secrets', async () => {
  const receipt = await receiptForBallot(fixture.manifest, fixture.ballots[0]);
  assert.deepEqual(Object.keys(receipt).sort(), ['ballotId', 'electionHash', 'electionId', 'schema']);
  const result = await verifyReceipt(fixture.record, receipt);
  assert.equal(result.valid, true);
  assert.equal(result.included, true);
  assert.equal(JSON.stringify(receipt).includes(fixture.credentials[0].secretKey), false);
  const changed = copy(receipt);
  changed.ballotId = '0'.repeat(64);
  assert.equal((await verifyReceipt(fixture.record, changed)).valid, false);
});

test('receipt cannot claim a valid final inclusion when tally or election changes', async () => {
  const receipt = await receiptForBallot(fixture.manifest, fixture.ballots[0]);
  const changed = copy(fixture.record);
  changed.tally[1] += 1;
  assert.equal((await verifyReceipt(changed, receipt)).valid, false);
  const wrongElection = { ...receipt, electionId: `${receipt.electionId}-other` };
  assert.equal((await verifyReceipt(fixture.record, wrongElection)).valid, false);
});

test('a changed published tally fails verification', async () => {
  const changed = copy(fixture.record);
  changed.tally[0] += 1;
  await invalidRecord(changed);
});

test('a changed encrypted aggregate fails verification', async () => {
  const changed = copy(fixture.record);
  changed.aggregate.ciphertexts[0].b = TWO;
  await invalidRecord(changed);
});

test('an incorrect aggregate ballot count fails verification', async () => {
  const changed = copy(fixture.record);
  changed.aggregate.count += 1;
  await invalidRecord(changed);
});

test('missing, duplicated, or reordered accepted ballots are detected against original final record', async () => {
  const missing = copy(fixture.record);
  missing.ballots.pop();
  await invalidRecord(missing);
  const duplicated = copy(fixture.record);
  duplicated.ballots.push(copy(duplicated.ballots[0]));
  await invalidRecord(duplicated);
  const reordered = copy(fixture.record);
  reordered.ballots.reverse();
  await invalidRecord(reordered, { expectedRecordHash: await hashRecord(fixture.record) });
});

test('valid subgroup ciphertext substitution cannot preserve the ballot proof', async () => {
  const changed = copy(fixture.ballots[0]);
  changed.ciphertexts[0].b = TWO;
  await invalidBallot(changed);
});

test('every disjunctive bit-proof scalar is bound to the ballot', async () => {
  for (const field of ['c0', 'z0', 'c1', 'z1']) {
    const changed = copy(fixture.ballots[0]);
    changed.bitProofs[0][field] = bumpHex(changed.bitProofs[0][field]);
    await invalidBallot(changed);
  }
});

test('an enrolled signer cannot authenticate away an invalid bit proof', async () => {
  for (const field of ['c0', 'z0', 'c1', 'z1']) {
    const changed = copy(fixture.ballots[0]);
    changed.bitProofs[0][field] = bumpHex(changed.bitProofs[0][field]);
    const signed = await authorizeChangedBallot(changed);
    const result = await verifyBallot(fixture.manifest, signed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('bit proof')), JSON.stringify(result.errors));
  }
});

test('a signed ballot with independently valid bits cannot select zero or two candidates', async () => {
  for (const bits of [[0, 0, 0], [1, 1, 0]]) {
    const ballot = await maliciousBitVector(bits);
    const result = await verifyBallot(fixture.manifest, ballot);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes('DLEQ proof')), JSON.stringify(result.errors));
  }
});

test('a valid signer cannot replace a ciphertext with a non-bit encrypted value', async () => {
  const changed = copy(fixture.ballots[0]);
  changed.ciphertexts[0].b = hex(mod(element(changed.ciphertexts[0].b) * G));
  const signed = await authorizeChangedBallot(changed);
  const result = await verifyBallot(fixture.manifest, signed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('bit proof')), JSON.stringify(result.errors));
});

test('the ballot total-one proof cannot be substituted', async () => {
  for (const field of ['c', 'z']) {
    const changed = copy(fixture.ballots[0]);
    changed.sumProof[field] = bumpHex(changed.sumProof[field]);
    await invalidBallot(changed);
  }
});

test('an enrolled signer cannot bypass the sum proof by re-signing its mutation', async () => {
  const changed = copy(fixture.ballots[0]);
  changed.sumProof.z = bumpHex(changed.sumProof.z);
  const signed = await authorizeChangedBallot(changed);
  const result = await verifyBallot(fixture.manifest, signed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('DLEQ proof')), JSON.stringify(result.errors));
});

test('changing a credential, signature, nullifier, or receipt ID invalidates ballot authentication', async () => {
  for (const alter of [
    ballot => { ballot.voterPublicKey = fixture.credentials[1].publicKey; },
    ballot => { ballot.signature.c = bumpHex(ballot.signature.c); },
    ballot => { ballot.signature.z = bumpHex(ballot.signature.z); },
    ballot => { ballot.nullifier = '0'.repeat(ballot.nullifier.length); },
    ballot => { ballot.id = '0'.repeat(ballot.id.length); },
  ]) {
    const changed = copy(fixture.ballots[0]);
    alter(changed);
    await invalidBallot(changed);
  }
});

test('ballots cannot be replayed under another election or relabelled candidates', async () => {
  for (const alter of [
    manifest => { manifest.electionId += '-another'; },
    manifest => { manifest.candidates[0] = 'Different candidate'; },
    manifest => { manifest.title = 'Different title'; },
  ]) {
    const manifest = copy(fixture.manifest);
    alter(manifest);
    await invalidBallot(fixture.ballots[0], manifest);
  }
});

test('canonical ciphertext encodings, range and subgroup requirements are enforced', async () => {
  for (const bad of ['', '02', '0x02', ZERO, 'f'.repeat(512), 'A'.repeat(512), -1, null, {}, []]) {
    const changed = copy(fixture.ballots[0]);
    changed.ciphertexts[0].a = bad;
    await invalidBallot(changed);
  }
});

test('noncanonical proof scalar encodings are rejected', async () => {
  for (const bad of ['1', '-1', 'f'.repeat(512), 1, null]) {
    const changed = copy(fixture.ballots[0]);
    changed.signature.z = bad;
    await invalidBallot(changed);
  }
});

test('ballot proof/ciphertext dimensions cannot disagree with the candidate manifest', async () => {
  for (const alter of [
    ballot => { ballot.ciphertexts.pop(); },
    ballot => { ballot.ciphertexts.push(copy(ballot.ciphertexts[0])); },
    ballot => { ballot.bitProofs.pop(); },
    ballot => { ballot.sumProof = null; },
  ]) {
    const changed = copy(fixture.ballots[0]);
    alter(changed);
    await invalidBallot(changed);
  }
});

test('invalid trustee public keys and changed Feldman commitments fail verification', async () => {
  for (const alter of [
    manifest => { manifest.trustees[0].publicKey = ONE; },
    manifest => { manifest.trustees[1].index = manifest.trustees[0].index; },
    manifest => { manifest.keyCommitments[0] = TWO; },
    manifest => { manifest.keyCommitments[1] = ONE; },
  ]) {
    const changed = copy(fixture.record);
    alter(changed.manifest);
    await invalidRecord(changed);
  }
});

test('wrong expected manifest or election-record digest is rejected', async () => {
  await invalidRecord(fixture.record, { expectedManifestHash: '0'.repeat(64) });
  await invalidRecord(fixture.record, { expectedRecordHash: '0'.repeat(64) });
});

test('public exports contain none of the synthetic trustee or credential secret values', () => {
  const publicText = JSON.stringify(fixture.record);
  for (const credential of fixture.credentials) {
    assert.equal(publicText.includes(credential.secretKey), false);
    assert.equal(publicText.includes(`\"alias\":${JSON.stringify(credential.alias)}`), false);
  }
  for (const trustee of fixture.trustees) {
    assert.equal(publicText.includes(trustee.secretShare), false);
  }
  for (const key of ['secretKey', 'secretShare', 'randomness', 'candidateIndex', 'selectedCandidate']) {
    assert.equal(publicText.includes(`\"${key}\":`), false);
  }
});

test('malformed top-level records produce an invalid report rather than a false pass', async () => {
  for (const value of [null, [], {}, { schema: 'unknown' }, { ...copy(fixture.record), shares: [] }]) {
    await invalidRecord(value);
  }
});

test('ballot creation rejects out-of-range candidate selections', async () => {
  for (const selection of [-1, 3, 0.5, NaN, Infinity, '0']) {
    await assert.rejects(() => encryptBallot(fixture.manifest, selection, fixture.credentials[0]));
  }
});

test('single-ballot election reveals only the mathematically unavoidable one-vote tally', async () => {
  const ballots = [fixture.ballots[1]];
  const shares = await Promise.all(fixture.trustees.slice(1).map(t =>
    createDecryptionShare(fixture.manifest, ballots, t)));
  const record = await finalizeElection(fixture.manifest, ballots, shares);
  const result = await verifyElectionRecord(record);
  assert.equal(result.valid, true);
  assert.deepEqual(result.tally, [0, 1, 0]);
});

test('empty election has a valid zero tally without pretending any voter participated', async () => {
  const ballots = [];
  const shares = await Promise.all(fixture.trustees.slice(0, 2).map(t =>
    createDecryptionShare(fixture.manifest, ballots, t)));
  const record = await finalizeElection(fixture.manifest, ballots, shares);
  const result = await verifyElectionRecord(record);
  assert.equal(result.valid, true);
  assert.equal(result.ballotCount, 0);
  assert.deepEqual(result.tally, [0, 0, 0]);
});
