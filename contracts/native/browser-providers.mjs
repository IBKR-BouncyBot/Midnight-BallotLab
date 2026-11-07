/** Real Midnight.js 5 browser providers, DApp Connector API 4.1.
 * Importing does not connect a wallet or send a transaction. The caller selects
 * a wallet and explicit test network, then calls connectNativeBrowserProviders.
 */
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { Transaction } from '@midnightntwrk/ledger-v9';
import { createLedger9WalletProvider, createLedger9MidnightProvider } from '@midnight-ntwrk/midnight-js-types';
import { fromHex, toHex, validatePassword, PasswordValidationError } from '@midnight-ntwrk/midnight-js-utils';
import { resolveNativeBrowserConfig, requireConnectedNetwork, requireNoReportedExternalProver } from './browser-config.mjs';
import { nativeConnectionFailure } from './connection-errors.mjs';
import { createNativeWasmProofProvider } from './browser-wasm-proof.mjs';
import { requirePreviewChainIdentity } from './public-testnet.mjs';

export { validatePassword as validateNativeStoragePassword };
export { nativeConnectionErrorMessage } from './connection-errors.mjs';
export { nativeWasmProofErrorMessage } from './browser-wasm-proof.mjs';

export function nativeStoragePasswordMessage(error) {
  // Use the installed SDK's error type, never its message or private payload.
  if (!(error instanceof PasswordValidationError)) return null;
  return 'Choose a stronger password for the keys stored by this app: at least 16 characters using three of uppercase letters, lowercase letters, numbers and symbols. Avoid sequences such as 1234 or abcd, and more than three identical characters in a row. This is separate from your Lace password.';
}

export async function connectNativeBrowserProviders({
  wallet, configuration, passwordProvider, onStage = () => {}, onProofProgress = () => {},
  pageUrl = globalThis.location?.href,
}) {
  if (typeof passwordProvider !== 'function' || typeof onStage !== 'function' || typeof onProofProgress !== 'function') throw new TypeError('Password and stage providers must be functions');
  const stage = value => {
    // Only finite stage names leave this module; never configurations, public
    // account identifiers, private data, transactions or error payloads.
    try { onStage(value); } catch { /* Observers cannot change the outcome. */ }
  };
  const connectionStep = async (name, operation) => {
    stage(name);
    try { return await operation(); }
    catch (error) {
      if (error instanceof PasswordValidationError) throw error;
      throw nativeConnectionFailure(name, error);
    }
  };
  const config = await connectionStep('connection-settings', () => resolveNativeBrowserConfig(configuration, pageUrl));
  if (!wallet || typeof wallet.connect !== 'function' || !/^4\.\d+\.\d+(?:[-+].*)?$/.test(wallet.apiVersion)) {
    throw new TypeError('Select a DApp Connector API 4 wallet');
  }
  // Fail before connecting or transacting if storage cannot encrypt its key.
  validatePassword(await passwordProvider());
  const chainIdentity = config.networkId === 'preview'
    ? await connectionStep('connection-chain', () => requirePreviewChainIdentity()) : undefined;
  const api = await connectionStep('connection-permission', () => wallet.connect(config.networkId));
  const [status, services, shielded, unshielded] = await connectionStep('connection-account', async () => {
    const values = await Promise.all([
      api.getConnectionStatus(), api.getConfiguration(), api.getShieldedAddresses(), api.getUnshieldedAddress(),
    ]);
    if (!values[3]?.unshieldedAddress || !values[2]?.shieldedCoinPublicKey || !values[2]?.shieldedEncryptionPublicKey) {
      throw new Error('Missing required public account identifiers');
    }
    return values;
  });
  await connectionStep('connection-network', () => requireConnectedNetwork(status, services, config.networkId));
  await connectionStep('connection-wallet-proving-mode', () => requireNoReportedExternalProver(services));
  const accountId = unshielded.unshieldedAddress;
  const coinKey = shielded.shieldedCoinPublicKey;
  const encryptionKey = shielded.shieldedEncryptionPublicKey;
  const sdkConfig = Object.freeze({ networkId: config.networkId, ttlSeconds: 3600 });
  let closed = false;
  const assertSession = async () => {
    if (closed) throw new Error('This native wallet session is closed');
    if (chainIdentity) await requirePreviewChainIdentity({}, chainIdentity);
    const [connection, currentServices, currentShielded, currentUnshielded] = await Promise.all([
      api.getConnectionStatus(), api.getConfiguration(), api.getShieldedAddresses(), api.getUnshieldedAddress(),
    ]);
    requireConnectedNetwork(connection, currentServices, config.networkId);
    requireNoReportedExternalProver(currentServices);
    if (currentUnshielded?.unshieldedAddress !== accountId || currentShielded?.shieldedCoinPublicKey !== coinKey
      || currentShielded?.shieldedEncryptionPublicKey !== encryptionKey) throw new Error('Wallet account changed; reconnect');
  };
  // Reject redirects as well as cross-origin paths. Prover/verifier files are
  // public, but silently changing their source breaks deployment provenance.
  const artifactFetch = (url, init) => {
    const target = new URL(url);
    const base = new URL(config.compiledAssetsUrl);
    if (target.origin !== base.origin || !target.pathname.startsWith(`${base.pathname}/`)) {
      throw new Error('Compiled asset request escaped the selected asset directory');
    }
    return globalThis.fetch(target.href, { ...init, redirect: 'error', credentials: 'same-origin' });
  };
  const zkConfigProvider = await connectionStep('connection-providers', () => {
    const expectedManifestHash = typeof __NATIVE_CONTRACT_MANIFEST_SHA256__ === 'string' ? __NATIVE_CONTRACT_MANIFEST_SHA256__ : '';
    if (!/^[0-9a-f]{64}$/.test(expectedManifestHash)) throw new Error('The compiled contract manifest pin is missing');
    return new FetchZkConfigProvider(config.compiledAssetsUrl,
      { fetchFunc: artifactFetch, verify: 'require', expectedManifestHash });
  });
  const underlyingProof = await connectionStep('connection-proving-provider',
    () => createNativeWasmProofProvider({ compiledAssetsUrl: config.compiledAssetsUrl, onStage: stage, onProofProgress }));
  try {
  const walletProvider = createLedger9WalletProvider({
    getCoinPublicKey: () => coinKey,
    getEncryptionPublicKey: () => encryptionKey,
    async balanceTx(transaction) {
      await assertSession();
      stage('wallet-approval-requested');
      const balanced = await api.balanceUnsealedTransaction(toHex(transaction.serialize()));
      // The official provider validates/seals these bytes as a finalized v9
      // transaction. Lace's API has no TTL option; it controls its fee intent.
      const result = fromHex(balanced.tx);
      stage('wallet-balanced');
      return result;
    },
  });
  const privateStateProvider = await connectionStep('connection-storage', () => levelPrivateStateProvider({
      accountId: `${config.networkId}:${chainIdentity?.genesisHash ?? 'local'}:${accountId}`,
      privateStateStoreName: 'midnight-ballot-private-state',
      signingKeyStoreName: 'midnight-ballot-signing-keys',
      privateStoragePasswordProvider: passwordProvider,
    }));
  const publicDataProvider = await connectionStep('connection-providers',
    () => indexerPublicDataProvider({ queryURL: config.indexerUri, subscriptionURL: config.indexerWsUri, webSocket: globalThis.WebSocket }));
  const providers = {
    config: sdkConfig,
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider: {
      supportedEras: underlyingProof.supportedEras,
      async proveTx(transaction, options) {
        await assertSession();
        stage('proving-provider-started');
        const proven = await underlyingProof.proveTx(transaction, options);
        // Deployments can traverse this provider without a contract-call proof.
        // This event means the provider returned, not that a network accepted it.
        stage('proving-provider-completed');
        return proven;
      },
    },
    walletProvider,
    midnightProvider: createLedger9MidnightProvider(async transaction => {
        await assertSession();
        await api.submitTransaction(toHex(transaction.serialize()));
        stage('submission-returned');
        const identifier = transaction.deserialize({ v9: Transaction }).identifiers()[0];
        if (!identifier) throw new Error('Submitted transaction did not have an identifier');
        return identifier;
      }),
  };
  stage('wallet-connected');
  return Object.freeze({ providers, networkId: config.networkId, chainIdentity, compiledAssetsPath: config.compiledAssetsUrl,
    assertSession,
    // This invalidates application use. It does not revoke wallet permissions,
    // erase IndexedDB or claim that in-flight submission can be cancelled.
    walletProvingMode: 'not-attestable-through-api4',
    close() { closed = true; underlyingProof.close(); },
  });
  } catch (error) {
    closed = true;
    underlyingProof.close();
    throw error;
  }
}
