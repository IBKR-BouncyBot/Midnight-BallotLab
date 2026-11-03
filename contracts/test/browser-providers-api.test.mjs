// These checks import the installed official SDK and exercise fail-before-call
// boundaries. They neither execute an election nor stand in for a real wallet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { connectNativeBrowserProviders } from '../native/browser-providers.mjs';

const settings = {
  networkId: 'preview', indexerUri: 'https://indexer.example/graphql',
  indexerWsUri: 'wss://indexer.example/graphql/ws', compiledAssetsUrl: './native-contract',
};
const pageUrl = 'https://example.github.io/ballot/network.html';

test('official SDK provider bootstrap validates storage password before requesting wallet access', async () => {
  let connections = 0;
  const wallet = { apiVersion: '4.0.1', connect() { connections++; throw new Error('Wallet access must not happen'); } };
  await assert.rejects(connectNativeBrowserProviders({ wallet, configuration: settings,
    pageUrl, passwordProvider: () => 'short' }), /Password/);
  assert.equal(connections, 0);
});

test('official SDK provider bootstrap rejects mainnet before requesting wallet access', async () => {
  let connections = 0;
  const wallet = { apiVersion: '4.0.1', connect() { connections++; throw new Error('Wallet access must not happen'); } };
  await assert.rejects(connectNativeBrowserProviders({ wallet, configuration: { ...settings, networkId: 'mainnet' },
    pageUrl, passwordProvider: () => 'NotUsed-AtAll-Q7#' }), /development network/);
  assert.equal(connections, 0);
});

test('official SDK provider bootstrap rejects incompatible connector APIs before wallet access', async () => {
  let connections = 0;
  const wallet = { apiVersion: '3.0.0', connect() { connections++; throw new Error('Wallet access must not happen'); } };
  await assert.rejects(connectNativeBrowserProviders({ wallet, configuration: settings,
    pageUrl, passwordProvider: () => 'NotUsed-AtAll-Q7#' }), /API 4/);
  assert.equal(connections, 0);
});
