// Actual configured generated-contract keys and native pure circuits.
// These checks do not generate proofs or submit network transactions.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeEmulator } from '../harness.mjs';
import { JUBJUB_SCALAR_ORDER } from '../adapter.mjs';
import { encodeTrusteeKeyFile, decodeTrusteeKeyFile, readTrusteeKeyFile, assertTrusteeKeyMatches } from '../../../src/trustee-key.mjs';

const bytes = last => { const value = new Uint8Array(32); value[31] = last; return value; };
let emulator, state, context;
const fileRecord = (trusteeIndex, secretShare, election = context) => ({ schema: 'midnight-ballot-lab/trustee-key/v1',
  ...election, trusteeIndex, secretShare: String(secretShare) });
before(async () => {
  emulator = await createNativeEmulator({ electionId: bytes(10), manifestDigest: bytes(11), administratorSecret: bytes(1),
    setupSecret: 11n, setupSlope: 7n, opensAt: 2_000_000_000, closesAt: 2_000_000_600, candidateCount: 3 });
  state = emulator.readLedger();
  context = { networkId: 'undeployed', contractAddress: emulator.contractAddress,
    configurationDigest: Buffer.from(state.configurationDigest).toString('hex') };
});

test('all three imported trustee files match their actual generated registered public keys', async () => {
  assert.equal(state.keysConfigured, true);
  for (const [offset, share] of [18n, 25n, 32n].entries()) {
    const text = encodeTrusteeKeyFile(fileRecord(offset + 1, share));
    const value = await readTrusteeKeyFile(new File([text], 'trustee.private.json'), context);
    assert.equal(assertTrusteeKeyMatches(value, state.trusteeKeys, emulator.pureCircuits.nativePublicKey), true);
  }
});

test('native trustee matching rejects other shares, indices, registered keys and election contexts', async () => {
  const nativePublicKey = emulator.pureCircuits.nativePublicKey;
  for (const value of [fileRecord(1, 25n), fileRecord(2, 18n), fileRecord(3, 33n), fileRecord(1, 0n), fileRecord(1, JUBJUB_SCALAR_ORDER)]) {
    assert.throws(() => assertTrusteeKeyMatches(value, state.trusteeKeys, nativePublicKey),
      error => error.message === 'Trustee key does not match the registered trustee public key' && error.cause === undefined);
  }
  const value = fileRecord(1, 18n);
  assert.throws(() => assertTrusteeKeyMatches(value, state.trusteeKeys.map(() => nativePublicKey(99n)), nativePublicKey));
  for (const keys of [[], state.trusteeKeys.slice(0, 2), [[1, 2], [3, 4], [5, 6]], undefined]) {
    assert.throws(() => assertTrusteeKeyMatches(value, keys, nativePublicKey));
  }
  const text = encodeTrusteeKeyFile(value);
  assert.throws(() => decodeTrusteeKeyFile(text, { ...context, contractAddress: 'ee'.repeat(32) }));
  assert.throws(() => decodeTrusteeKeyFile(text, { ...context, configurationDigest: 'ef'.repeat(32) }));
});

test('a near-order trustee share matches after real native key configuration', async () => {
  const boundary = await createNativeEmulator({ electionId: bytes(12), manifestDigest: bytes(13), administratorSecret: bytes(1),
    setupSecret: JUBJUB_SCALAR_ORDER - 7n, setupSlope: 2n,
    opensAt: 2_000_000_000, closesAt: 2_000_000_600, candidateCount: 2 });
  const ledger = boundary.readLedger();
  const identity = { networkId: 'undeployed', contractAddress: boundary.contractAddress,
    configurationDigest: Buffer.from(ledger.configurationDigest).toString('hex') };
  const value = decodeTrusteeKeyFile(encodeTrusteeKeyFile(fileRecord(3, JUBJUB_SCALAR_ORDER - 1n, identity)), identity);
  assert.equal(assertTrusteeKeyMatches(value, ledger.trusteeKeys, boundary.pureCircuits.nativePublicKey), true);
});
