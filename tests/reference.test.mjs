import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  setupElection, encryptBallot, createDecryptionShare, finalizeElection,
  hashManifest, hashRecord,
} from '../src/protocol.mjs';
import { Q, hex, scalar, element, hash, sign } from '../src/crypto.mjs';

// This test creates records in JavaScript and checks them using independent
// Python arithmetic, transcript serialization and proof verification. The
// Python verifier neither imports nor executes the JavaScript implementation.
const verifier = fileURLToPath(new URL('../scripts/verify_reference.py', import.meta.url));
const python = process.env.PYTHON || process.env.CODEX_PRIMARY_RUNTIME_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const copy = value => JSON.parse(JSON.stringify(value));
let fixture;

before(async () => {
  const setup = await setupElection({
    id: 'cross-language-election-v1', title: 'Independent verifier — élection 🗳',
    candidates: ['Option A 💡', 'Option Bé', 'Option C'], maxBallots: 8, voterCount: 3,
  });
  const ballots = [];
  for (const [index, choice] of [0, 1, 2].entries()) {
    ballots.push(await encryptBallot(setup.manifest, choice, setup.credentials[index]));
  }
  const shares = await Promise.all(setup.trustees.map(trustee =>
    createDecryptionShare(setup.manifest, ballots, trustee)));
  const record = await finalizeElection(setup.manifest, ballots, shares.slice(0, 2));
  fixture = { ...setup, ballots, shares, record };
});

function verify(record, args = []) {
  const process = spawnSync(python, [verifier, '-', ...args], {
    input: typeof record === 'string' ? record : JSON.stringify(record),
    encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120_000,
  });
  assert.ifError(process.error);
  assert.equal(process.stderr, '', 'reference verifier should report failures as JSON');
  return { status: process.status, result: JSON.parse(process.stdout) };
}

function rejects(record, errorPattern, args) {
  const { status, result } = verify(record, args);
  assert.equal(status, 1);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('; '), errorPattern);
}

test('Python independently verifies Unicode transcripts, proofs and trusted record fingerprints', async () => {
  const manifestHash = await hashManifest(fixture.manifest);
  const recordHash = await hashRecord(fixture.record);
  const { status, result } = verify(fixture.record, [
    '--expected-manifest-hash', manifestHash, '--expected-record-hash', recordHash,
  ]);
  assert.equal(status, 0, result.errors.join('; '));
  assert.equal(result.valid, true);
  assert.equal(result.anchored, true);
  assert.equal(result.manifestHash, manifestHash);
  assert.equal(result.recordHash, recordHash);
  assert.deepEqual(result.tally, [1, 1, 1]);
  assert.equal(result.ballotCount, 3);
  assert.equal(result.checks.every(check => check.valid), true);
});

test('Python accepts all three threshold shares and reports missing external anchors', async () => {
  const record = await finalizeElection(fixture.manifest, fixture.ballots, fixture.shares);
  const { status, result } = verify(record);
  assert.equal(status, 0, result.errors.join('; '));
  assert.equal(result.anchored, false);
  assert.equal(result.manifestAnchored, false);
  assert.equal(result.recordAnchored, false);
  assert.deepEqual(result.tally, [1, 1, 1]);
  assert.equal(result.warnings.length, 3);
});

test('Python verifies empty elections and interpolation from trustees two and three', async () => {
  const shares = await Promise.all(fixture.trustees.slice(1).map(trustee =>
    createDecryptionShare(fixture.manifest, [], trustee)));
  const record = await finalizeElection(fixture.manifest, [], shares);
  const { status, result } = verify(record);
  assert.equal(status, 0, result.errors.join('; '));
  assert.deepEqual(result.tally, [0, 0, 0]);
  assert.equal(result.ballotCount, 0);
});

test('Python rejects a changed published tally', () => {
  const record = copy(fixture.record);
  record.tally[0] += 1;
  rejects(record, /Published tally does not match/);
});

test('Python rejects a tampered bit proof even after authorized re-signing and receipt rehashing', async () => {
  const record = copy(fixture.record);
  const ballot = record.ballots[0];
  ballot.bitProofs[0].z0 = hex((scalar(ballot.bitProofs[0].z0) + 1n) % Q);
  const { id: omittedId, signature: omittedSignature, ...unsigned } = ballot;
  const credential = fixture.credentials[0];
  ballot.signature = await sign(await hash('signed-ballot', unsigned),
    element(credential.publicKey), scalar(credential.secretKey));
  const { id: omittedReceipt, ...signed } = ballot;
  ballot.id = await hash('ballot-receipt', signed);
  rejects(record, /Ballot bit proof failed/);
});

test('Python rejects a corrupted trustee proof', () => {
  const record = copy(fixture.record);
  const proof = record.shares[0].values[0].proof;
  proof.z = hex((scalar(proof.z) + 1n) % Q);
  rejects(record, /DLEQ proof failed/);
});

test('Python rejects duplicate credential use before trusting the encrypted aggregate', () => {
  const record = copy(fixture.record);
  record.ballots.push(copy(record.ballots[0]));
  rejects(record, /Duplicate ballot fingerprint/);
});

test('Python rejects inconsistent threshold public commitments', () => {
  const record = copy(fixture.record);
  record.manifest.trustees[0].publicKey = record.manifest.trustees[1].publicKey;
  rejects(record, /Trustee key is inconsistent/);
});

test('Python does not confuse a boolean with trustee index one', () => {
  const record = copy(fixture.record);
  record.manifest.trustees[0].index = true;
  rejects(record, /Trustee index: invalid integer/);
});

test('Python rejects duplicate JSON fields and negative-zero or unsafe numbers', () => {
  rejects('{"schema":"a","schema":"b"}', /Duplicate JSON object field/);
  rejects('{"x":-0}', /Negative zero/);
  rejects('{"x":9007199254740992}', /Unsafe JSON integer/);
});

test('Python rejects mismatched external record fingerprints', () => {
  rejects(fixture.record, /independently trusted final-record fingerprint/,
    ['--expected-record-hash', '0'.repeat(64)]);
});
