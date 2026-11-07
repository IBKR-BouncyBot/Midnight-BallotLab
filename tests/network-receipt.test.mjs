// Public receipt encoding only; no fabricated cryptography or network proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeNetworkReceipt, decodeNetworkReceipt, networkReceiptNextSteps } from '../src/network-receipt.mjs';
import { qrMatrix } from '../src/qr.mjs';

const receipt = { schema: 'midnight-ballot-lab/native-receipt/v1', networkId: 'preview',
  contractAddress: 'ab'.repeat(32), configurationDigest: '12'.repeat(32), receipt: 'cd'.repeat(32), index: 1023 };

test('network receipt QR round trips all supported network contexts within QR capacity', () => {
  for (const networkId of ['undeployed', 'preview']) {
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
  assert.throws(() => encodeNetworkReceipt({ ...receipt, networkId: 'preprod' }), /ledger-9 build cannot use Preprod/);
  assert.throws(() => decodeNetworkReceipt(encodeNetworkReceipt(receipt).replace(':preview:', ':preprod:')), /ledger-9 build cannot use Preprod/);
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

test('an ID alone remains distinct from a full contextual network receipt', () => {
  assert.throws(() => decodeNetworkReceipt(receipt.receipt));
  assert.throws(() => decodeNetworkReceipt(JSON.stringify({ receipt: receipt.receipt })));
  assert.throws(() => decodeNetworkReceipt(JSON.stringify({ ...receipt, configurationDigest: undefined })));
  assert.throws(() => decodeNetworkReceipt(JSON.stringify({ ...receipt, receipt: receipt.receipt.toUpperCase() })));
});

test('post-vote guidance uses actual closing time and requires closing, two shares and finalization', () => {
  const open = networkReceiptNextSteps({ phase: 1n, closesAt: 2_000_000_600n });
  assert.ok(open.includes('2033-05-18 03:43:20 UTC'));
  for (const phrase of ['close-voting transaction', 'two trustees must contribute', 'finalization transaction',
    'results do not appear automatically', 'full receipt', 'Refresh election record']) {
    assert.ok(open.includes(phrase), 'Post-vote guidance must preserve operational limits');
  }
  const closed = networkReceiptNextSteps({ phase: 2n, closesAt: 2_000_000_600n });
  assert.ok(closed.includes('Voting is closed in your indexer’s record'));
  assert.ok(closed.includes('Two trustees must contribute'));
  assert.ok(closed.includes('closing alone does not reveal results'));
  const finalized = networkReceiptNextSteps({ phase: 3n, closesAt: 2_000_000_600n });
  assert.ok(finalized.includes('Your indexer reports that the tally is finalized'));
  assert.ok(finalized.includes('reported totals'));
  for (const text of [open, closed, finalized]) assert.ok(text.length < 600, 'Post-vote guidance stays concise');
  assert.throws(() => networkReceiptNextSteps({ phase: 3, closesAt: 2_000_000_600n }));
  assert.throws(() => networkReceiptNextSteps({ phase: 1n, closesAt: -1n }));
  assert.ok(networkReceiptNextSteps({ phase: 1n, closesAt: 2n ** 64n - 1n }).includes('Unix time'));
});
