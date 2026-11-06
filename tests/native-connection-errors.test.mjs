// Error-format boundaries only: no wallet connection, cryptography or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeConnectionFailure, nativeConnectionErrorMessage } from '../contracts/native/connection-errors.mjs';

const marker = 'SYNTHETIC-PRIVATE-ERROR-PAYLOAD';
const stages = ['connection-settings', 'connection-permission', 'connection-account', 'connection-network',
  'connection-local-prover', 'connection-local-prover-unreported', 'connection-proving-provider',
  'connection-storage', 'connection-providers'];

test('only locally branded connection errors yield safe stage-specific diagnostics', () => {
  const texts = new Set();
  for (const stage of stages) {
    const failure = nativeConnectionFailure(stage, new Error(marker, { cause: { secret: marker } }));
    const message = nativeConnectionErrorMessage(failure);
    assert.ok(typeof message === 'string' && message.includes('No transaction was submitted.'));
    assert.ok(!message.includes(marker)); assert.equal(failure.cause, undefined);
    assert.deepEqual(Object.keys(failure).sort(), ['name', 'stage']);
    assert.equal(failure.stage, stage); texts.add(message);
    failure.message = marker;
    assert.equal(nativeConnectionErrorMessage(failure), message, 'Mutating an Error message must not change safe diagnostics');
    assert.equal(nativeConnectionErrorMessage({ ...failure }), null, 'Copying public fields must not forge the local brand');
  }
  assert.equal(texts.size, stages.length);
  for (const value of [null, undefined, marker, {}, new Error(marker), { name: 'NativeConnectionError', stage: stages[0], message: marker }]) {
    assert.equal(nativeConnectionErrorMessage(value), null);
  }
  assert.throws(() => nativeConnectionFailure('unknown', new Error(marker)), /Unknown connection stage/);
});

test('documented API-4 rejection and disconnection codes use fixed text without raw reasons', () => {
  const expected = {
    Rejected: 'The wallet request was rejected. No automatic retry was made.',
    PermissionRejected: 'Lace denied permission for this app. Review its connected-app permissions, unlock the wallet and connect again. No transaction was submitted.',
    Disconnected: 'Lace disconnected while setting up this connection. Unlock the wallet, check its selected Midnight network and reconnect. No transaction was submitted.',
  };
  for (const [code, message] of Object.entries(expected)) {
    const failure = nativeConnectionFailure('connection-account', { type: 'DAppConnectorAPIError', code,
      get reason() { throw new Error(marker); }, get message() { throw new Error(marker); } });
    assert.equal(nativeConnectionErrorMessage(failure), message);
  }
  for (const input of [{ type: 'DAppConnectorAPIError', code: marker, reason: marker },
    { type: 'Untrusted', code: 'Rejected' }, { get type() { throw new Error(marker); } }]) {
    const failure = nativeConnectionFailure('connection-account', input);
    assert.ok(nativeConnectionErrorMessage(failure).startsWith('Lace did not return'));
    assert.ok(!nativeConnectionErrorMessage(failure).includes(marker));
  }
});

test('omitted deprecated prover field is distinguished from an unsupported reported destination', () => {
  const missing = nativeConnectionErrorMessage(nativeConnectionFailure('connection-local-prover-unreported'));
  const unsupported = nativeConnectionErrorMessage(nativeConnectionFailure('connection-local-prover'));
  assert.ok(missing.includes('did not report its prover address through the wallet API'));
  assert.ok(missing.includes('even if a custom prover is visible'));
  assert.ok(unsupported.includes('http://localhost:6300'));
  assert.notEqual(missing, unsupported);
});
