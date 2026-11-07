import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CHAIN_IDENTITY } from '../native/public-testnet.mjs';
import { validateChainIdentity, validateChainCheckpoints } from '../../scripts/ci-preview-chain-evidence.mjs';

// Public format fixtures only, not a wallet, proof, network or success substitute.
const chainIdentity = { ...PREVIEW_CHAIN_IDENTITY, protocolVersion: 2001100 };
const point = (checkpoint, operationOrdinal) => ({ checkpoint, checkedAt: '2026-11-07T09:00:00.000Z',
  ...(operationOrdinal === undefined ? {} : { operationOrdinal }) });
const funded = () => ({ chainIdentity, chainCheckpoints: [point('before-wallet-creation'), point('before-funding-request'),
  point('before-dust-registration'), ...Array.from({ length: 9 }, (_, i) => point('before-application-operation', i + 1))] });

test('public identity metadata rejects another reset, ledger era, unknown protocol and private fields', () => {
  assert.deepEqual(validateChainIdentity(chainIdentity), chainIdentity);
  for (const value of [undefined, null, { ...chainIdentity, genesisHash: '0x' + 'd'.repeat(64) },
    { ...chainIdentity, protocolVersion: 1000400 }, { ...chainIdentity, protocolVersion: 3000000 },
    { ...chainIdentity, ledgerEra: 'v8' }, { ...chainIdentity, secret: 'do-not-publish' },
    { ...chainIdentity, get genesisHash() { throw new Error('do-not-publish'); } }]) {
    assert.throws(() => validateChainIdentity(value), { message: 'Public chain evidence validation failed' });
  }
});

test('funded completion requires all ordered pre-action checkpoints while failed prefixes remain distinguishable', () => {
  const full = funded();
  validateChainCheckpoints(full, { mode: 'funded', completed: true });
  validateChainCheckpoints({}, { mode: 'funded' });
  validateChainCheckpoints({ chainIdentity, chainCheckpoints: full.chainCheckpoints.slice(0, 2) }, { mode: 'funded' });
  for (const invalid of [{}, { chainIdentity }, { chainCheckpoints: full.chainCheckpoints },
    { chainIdentity, chainCheckpoints: [] }, { chainIdentity, chainCheckpoints: full.chainCheckpoints.slice(0, 11) },
    { chainIdentity, chainCheckpoints: [...full.chainCheckpoints, point('before-application-operation', 10)] },
    { chainIdentity, chainCheckpoints: full.chainCheckpoints.map((p, i) => i === 4 ? { ...p, operationOrdinal: 1 } : p) },
    { chainIdentity, chainCheckpoints: full.chainCheckpoints.map((p, i) => i === 1 ? { ...p, checkedAt: '2026-02-30T09:00:00.000Z' } : p) },
    { chainIdentity, chainCheckpoints: full.chainCheckpoints.map((p, i) => i === 1 ? { ...p, checkedAt: '2026-11-06T09:00:00.000Z' } : p) },
    { chainIdentity, chainCheckpoints: full.chainCheckpoints.map((p, i) => i === 1 ? { ...p, witness: 'do-not-publish' } : p) },
  ]) assert.throws(() => validateChainCheckpoints(invalid, { mode: 'funded', completed: true }));
});

test('fundless completion accepts only wallet-creation and proof checkpoints, never funding or operations', () => {
  const report = { chainIdentity, chainCheckpoints: [point('before-wallet-creation'), point('before-fundless-proof')] };
  validateChainCheckpoints(report, { mode: 'diagnostic', completed: true });
  for (const chainCheckpoints of [[point('before-fundless-proof'), point('before-wallet-creation')],
    [point('before-wallet-creation'), point('before-funding-request')],
    [point('before-wallet-creation'), point('before-fundless-proof', 1)]]) {
    assert.throws(() => validateChainCheckpoints({ chainIdentity, chainCheckpoints }, { mode: 'diagnostic', completed: true }));
  }
});
