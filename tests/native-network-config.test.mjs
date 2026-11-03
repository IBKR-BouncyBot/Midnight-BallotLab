// Configuration boundary tests only. These do not simulate Midnight execution,
// generate a proof, connect a real wallet, or submit a transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { findNativeWallets, requireDevelopmentNetwork, requireConnectedNetwork, requireLocalWalletProver, nativeNetworkErrorMessage,
  resolveNativeBrowserConfig } from '../contracts/native/browser-config.mjs';

const config = {
  networkId: 'preview', indexerUri: 'https://indexer.example/graphql',
  indexerWsUri: 'wss://indexer.example/graphql/ws', compiledAssetsUrl: './native-contract/',
};

test('network configuration requires an explicit supported development environment', () => {
  for (const network of ['undeployed', 'preview', 'preprod']) assert.equal(requireDevelopmentNetwork(network), network);
  for (const network of [undefined, '', 'mainnet', 'Preview', 'testnet', 'preview ']) {
    assert.throws(() => requireDevelopmentNetwork(network), /development network/);
  }
});

test('connector discovery uses entry IDs and preserves multiple wallet choices', () => {
  const first = { name: 'Wallet A', rdns: 'example.wallet', apiVersion: '4.0.1', connect() {} };
  const second = { ...first, name: 'Wallet B' };
  const result = findNativeWallets({ 'new-id': first, 'another-id': second,
    obsolete: { ...first, apiVersion: '3.0.0' }, missing: {}, badVersion: { ...first, apiVersion: null } });
  assert.deepEqual(result.map(({ id }) => id), ['new-id', 'another-id']);
  assert.equal(result[1].wallet, second);
  assert.deepEqual(findNativeWallets(null), []);
});

test('asset URLs preserve GitHub Pages repository subdirectories', () => {
  const root = resolveNativeBrowserConfig(config, 'https://example.github.io/native.html');
  const project = resolveNativeBrowserConfig(config, 'https://example.github.io/ballot/native.html');
  assert.equal(root.compiledAssetsUrl, 'https://example.github.io/native-contract');
  assert.equal(project.compiledAssetsUrl, 'https://example.github.io/ballot/native-contract');
});

test('network configuration rejects remote insecure services and credential-bearing URLs', () => {
  for (const overrides of [
    { indexerUri: 'http://indexer.example/graphql' }, { indexerWsUri: 'ws://indexer.example/ws' },
    { indexerUri: 'https://user:password@indexer.example/graphql' },
    { indexerWsUri: 'wss://indexer.example/ws#fragment' },
    { compiledAssetsUrl: 'https://untrusted.example/keys' },
    { compiledAssetsUrl: './native-contract?key=secret' },
  ]) assert.throws(() => resolveNativeBrowserConfig({ ...config, ...overrides }, 'https://example.github.io/ballot/native.html'));
});

test('local development permits only loopback insecure endpoints', () => {
  const local = resolveNativeBrowserConfig({ ...config, networkId: 'undeployed',
    indexerUri: 'http://127.0.0.1:8088/graphql', indexerWsUri: 'ws://localhost:8088/graphql/ws' }, 'http://localhost:4173/native.html');
  assert.equal(local.networkId, 'undeployed');
  assert.throws(() => resolveNativeBrowserConfig({ ...config, indexerUri: 'http://localhost.evil.example/graphql' }, 'https://example.github.io/'));
});

test('both wallet connection and wallet service configuration must match', () => {
  const connected = { status: 'connected', networkId: 'preview' };
  requireConnectedNetwork(connected, { networkId: 'preview' }, 'preview');
  assert.throws(() => requireConnectedNetwork({ ...connected, status: 'disconnected' }, { networkId: 'preview' }, 'preview'));
  assert.throws(() => requireConnectedNetwork({ ...connected, networkId: 'mainnet' }, { networkId: 'preview' }, 'preview'));
  assert.throws(() => requireConnectedNetwork(connected, { networkId: 'preprod' }, 'preview'));
});

test('browser CSP limits insecure IPv6 indexers without restricting the wallet prover', () => {
  for (const overrides of [{ indexerUri: 'http://[::1]:8088/graphql' }, { indexerWsUri: 'ws://[::1]:8088/graphql/ws' }]) {
    assert.throws(() => resolveNativeBrowserConfig({ ...config, ...overrides }, 'http://[::1]:4173/network.html'), /localhost or 127/);
  }
  assert.equal(requireLocalWalletProver({ proverServerUri: 'http://[::1]:6300' }), 'http://[::1]:6300/');
  const allowed = resolveNativeBrowserConfig({ ...config, indexerUri: 'http://localhost:8088/graphql',
    indexerWsUri: 'ws://127.0.0.1:8088/graphql/ws' }, 'http://[::1]:4173/network.html');
  assert.equal(allowed.compiledAssetsUrl, 'http://[::1]:4173/native-contract');
});

test('private witnesses are restricted to a wallet reporting a loopback prover', () => {
  assert.equal(requireLocalWalletProver({ proverServerUri: 'http://localhost:6300' }), 'http://localhost:6300/');
  for (const proverServerUri of [undefined, 'https://prover.example', 'http://localhost.evil.example', 'http://localhost:6300?secret=1']) {
    assert.throws(() => requireLocalWalletProver({ proverServerUri }));
  }
});

test('public error text does not expose wallet or proof error payloads', () => {
  const privateMarker = 'PRIVATE-WITNESS-AND-SECRET';
  for (const error of [new Error(privateMarker), { type: 'DAppConnectorAPIError', reason: privateMarker,
    code: privateMarker, message: privateMarker, cause: { proofData: privateMarker } }, null]) {
    assert(!nativeNetworkErrorMessage(error).includes(privateMarker));
  }
});
