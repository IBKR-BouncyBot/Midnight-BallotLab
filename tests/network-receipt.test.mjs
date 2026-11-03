// Public receipt encoding only; no fabricated cryptography or network proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeNetworkReceipt, decodeNetworkReceipt } from '../src/network-receipt.mjs';
import { qrMatrix } from '../src/qr.mjs';

const receipt = { schema: 'midnight-ballot-lab/native-receipt/v1', networkId: 'preview',
  contractAddress: 'ab'.repeat(32), configurationDigest: '12'.repeat(32), receipt: 'cd'.repeat(32), index: 1023 };

test('network receipt QR round trips all supported network contexts within QR capacity', () => {
  for (const networkId of ['undeployed', 'preview', 'preprod']) {
    const value = { ...receipt, networkId };
    const text = encodeNetworkReceipt(value);
    assert.deepEqual(decodeNetworkReceipt(text), value);
    assert.equal(qrMatrix(text).length, 49);
  }
});

test('network receipt context cannot be confused with local emulator receipts', () => {
  assert.throws(() => encodeNetworkReceipt({ ...receipt, schema: 'midnight-ballot-lab/native-emulator-receipt/v1' }));
  assert.throws(() => decodeNetworkReceipt('mbne1:0:invalid'));
  assert.throws(() => decodeNetworkReceipt(encodeNetworkReceipt(receipt).replace(':preview:', ':mainnet:')));
});

test('network receipt rejects malformed digest, index and noncanonical text', () => {
  for (const index of [-1, 1024, 0.5, '0']) assert.throws(() => encodeNetworkReceipt({ ...receipt, index }));
  assert.throws(() => encodeNetworkReceipt({ ...receipt, receipt: 'bad' }));
  assert.throws(() => decodeNetworkReceipt(encodeNetworkReceipt(receipt).replace(':1023:', ':0102:')));
  assert.throws(() => decodeNetworkReceipt(encodeNetworkReceipt(receipt) + '=='));
});

test('receipt JSON decode excludes unrelated private fields and rejects duplicate keys', () => {
  assert.deepEqual(decodeNetworkReceipt(JSON.stringify({ ...receipt, secret: 'NEVER-EXPORT', proofData: 'PRIVATE' })), receipt);
  assert.throws(() => decodeNetworkReceipt(JSON.stringify(receipt).replace('"index":1023', '"index":1023,"index":0')));
});
