/** Real Midnight.js 4.1.1 browser providers, DApp Connector API 4.0.1.
 * Importing does not connect a wallet or send a transaction. The caller selects
 * a wallet and explicit test network, then calls connectNativeBrowserProviders.
 */
import { dappConnectorProofProvider } from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CostModel, Transaction } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { fromHex, toHex, validatePassword, PasswordValidationError } from '@midnight-ntwrk/midnight-js-utils';
import { resolveNativeBrowserConfig, requireConnectedNetwork, requireLocalWalletProver } from './browser-config.mjs';

export { validatePassword as validateNativeStoragePassword };

export function nativeStoragePasswordMessage(error) {
  // Use the installed SDK's error type, never its message or private payload.
  if (!(error instanceof PasswordValidationError)) return null;
  return 'Choose a stronger password for the keys stored by this app: at least 16 characters using three of uppercase letters, lowercase letters, numbers and symbols. Avoid sequences such as 1234 or abcd, and more than three identical characters in a row. This is separate from your Lace password.';
}

export async function connectNativeBrowserProviders({
  wallet, configuration, passwordProvider, onStage = () => {},
  pageUrl = globalThis.location?.href,
}) {
  const config = resolveNativeBrowserConfig(configuration, pageUrl);
  if (typeof passwordProvider !== 'function' || typeof onStage !== 'function') throw new TypeError('Password and stage providers must be functions');
  if (!wallet || typeof wallet.connect !== 'function' || !/^4\.\d+\.\d+(?:[-+].*)?$/.test(wallet.apiVersion)) {
    throw new TypeError('Select a DApp Connector API 4 wallet');
  }
  // Fail before connecting or transacting if storage cannot encrypt its key.
  validatePassword(await passwordProvider());
  const api = await wallet.connect(config.networkId);
  const [status, services, shielded, unshielded] = await Promise.all([
    api.getConnectionStatus(), api.getConfiguration(), api.getShieldedAddresses(), api.getUnshieldedAddress(),
  ]);
  requireConnectedNetwork(status, services, config.networkId);
  const proverUri = requireLocalWalletProver(services);
  if (!unshielded?.unshieldedAddress || !shielded?.shieldedCoinPublicKey || !shielded?.shieldedEncryptionPublicKey) {
    throw new Error('The selected wallet did not supply its required public account identifiers');
  }
  const accountId = unshielded.unshieldedAddress;
  const coinKey = shielded.shieldedCoinPublicKey;
  const encryptionKey = shielded.shieldedEncryptionPublicKey;
  setNetworkId(config.networkId);
  let closed = false;
  const stage = value => {
    // The callback receives only this finite set of stage names. Never pass a
    // transaction, a witness, an error object, or provider configuration to it.
    try { onStage(value); } catch { /* UI observers cannot change a transaction outcome. */ }
  };
  const assertSession = async () => {
    if (closed) throw new Error('This native wallet session is closed');
    if (getNetworkId() !== config.networkId) throw new Error('Midnight.js network changed');
    const [connection, currentServices, currentShielded, currentUnshielded] = await Promise.all([
      api.getConnectionStatus(), api.getConfiguration(), api.getShieldedAddresses(), api.getUnshieldedAddress(),
    ]);
    requireConnectedNetwork(connection, currentServices, config.networkId);
    if (requireLocalWalletProver(currentServices) !== proverUri) throw new Error('Wallet prover changed; reconnect');
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
  const zkConfigProvider = new FetchZkConfigProvider(config.compiledAssetsUrl, artifactFetch);
  const underlyingProof = await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel());
  const walletProvider = {
    getCoinPublicKey: () => coinKey,
    getEncryptionPublicKey: () => encryptionKey,
    async balanceTx(transaction) {
      await assertSession();
      stage('wallet-approval-requested');
      const balanced = await api.balanceUnsealedTransaction(toHex(transaction.serialize()));
      const result = Transaction.deserialize('signature', 'proof', 'binding', fromHex(balanced.tx));
      stage('wallet-balanced');
      return result;
    },
  };
  const providers = {
    privateStateProvider: levelPrivateStateProvider({
      accountId: `${config.networkId}:${accountId}`,
      privateStateStoreName: 'midnight-ballot-private-state',
      signingKeyStoreName: 'midnight-ballot-signing-keys',
      privateStoragePasswordProvider: passwordProvider,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexerUri, config.indexerWsUri, globalThis.WebSocket),
    zkConfigProvider,
    proofProvider: {
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
    midnightProvider: {
      async submitTx(transaction) {
        await assertSession();
        await api.submitTransaction(toHex(transaction.serialize()));
        stage('submission-returned');
        const identifier = transaction.identifiers()[0];
        if (!identifier) throw new Error('Submitted transaction did not have an identifier');
        return identifier;
      },
    },
  };
  stage('wallet-connected');
  return Object.freeze({ providers, networkId: config.networkId, compiledAssetsPath: config.compiledAssetsUrl,
    assertSession,
    // This invalidates application use. It does not revoke wallet permissions,
    // erase IndexedDB or claim that in-flight submission can be cancelled.
    close() { closed = true; },
  });
}
