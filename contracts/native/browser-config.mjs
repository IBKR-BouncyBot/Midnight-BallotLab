/** Public configuration boundaries for the development/test network client.
 * These functions perform no cryptography, wallet connection, or network call.
 */
const DEVELOPMENT_NETWORKS = new Set(['undeployed', 'preview', 'preprod']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function requireDevelopmentNetwork(networkId) {
  if (!DEVELOPMENT_NETWORKS.has(networkId)) {
    throw new TypeError('Choose an explicit development network: undeployed, preview or preprod');
  }
  return networkId;
}

export function findNativeWallets(registry = globalThis.midnight) {
  if (!registry || typeof registry !== 'object') return [];
  // Connector IDs change after reload. Keep all compatible entries so the UI
  // can ask the user which one to connect, including duplicate rdns claims.
  return Object.entries(registry)
    .filter(([, wallet]) => wallet && typeof wallet.connect === 'function'
      && typeof wallet.apiVersion === 'string' && /^4\.\d+\.\d+(?:[-+].*)?$/.test(wallet.apiVersion)
      && typeof wallet.rdns === 'string' && typeof wallet.name === 'string')
    .map(([id, wallet]) => ({ id, name: wallet.name, rdns: wallet.rdns, apiVersion: wallet.apiVersion, wallet }));
}

function serviceUrl(value, protocols, name) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${name} must be an absolute URL`); }
  if (!protocols.includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError(`${name} has an unsupported protocol, credentials or fragment`);
  }
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && !LOOPBACK.has(url.hostname)) {
    throw new TypeError(`${name} requires a secure connection except on loopback`);
  }
  return url;
}

export function resolveNativeBrowserConfig({ networkId, indexerUri, indexerWsUri, compiledAssetsUrl }, pageUrl) {
  requireDevelopmentNetwork(networkId);
  const page = serviceUrl(pageUrl, ['http:', 'https:'], 'Page URL');
  const indexer = serviceUrl(indexerUri, ['http:', 'https:'], 'Indexer URL');
  const websocket = serviceUrl(indexerWsUri, ['ws:', 'wss:'], 'Indexer WebSocket URL');
  if ((indexer.protocol === 'http:' && indexer.hostname === '[::1]')
    || (websocket.protocol === 'ws:' && websocket.hostname === '[::1]')) {
    throw new TypeError('Use localhost or 127.0.0.1 for insecure loopback indexer endpoints; browser CSP does not accept IPv6 host sources');
  }
  if (typeof compiledAssetsUrl !== 'string' || !compiledAssetsUrl) throw new TypeError('compiledAssetsUrl is required');
  const assets = serviceUrl(new URL(compiledAssetsUrl, page).href, ['http:', 'https:'], 'Compiled asset URL');
  if (assets.origin !== page.origin || assets.search) throw new TypeError('Compiled assets must be served from this page origin without a query');
  // FetchZkConfigProvider appends /keys and /zkir. Relative resolution retains
  // a GitHub project path such as /midnight-ballot-lab/native-contract.
  return Object.freeze({
    networkId,
    indexerUri: indexer.href,
    indexerWsUri: websocket.href,
    compiledAssetsUrl: assets.href.replace(/\/+$/, ''),
  });
}

export function requireConnectedNetwork(status, configuration, networkId) {
  requireDevelopmentNetwork(networkId);
  if (status?.status !== 'connected' || status.networkId !== networkId || configuration?.networkId !== networkId) {
    throw new Error('Wallet connection or configuration does not match the selected development network');
  }
}

export function requireLocalWalletProver(configuration) {
  // API 4.0.1 still exposes this optional, deprecated field. Without it we
  // cannot inspect the destination used by this prototype's wallet prover.
  const prover = serviceUrl(configuration?.proverServerUri, ['http:', 'https:'], 'Wallet prover URL');
  if (!LOOPBACK.has(prover.hostname) || prover.search) {
    throw new Error('This prototype requires the wallet to report a local loopback prover');
  }
  return prover.href;
}

export function nativeNetworkErrorMessage(error) {
  // Wallet/SDK errors can include serialized inputs and remote error bodies.
  // Never forward message, stack, cause or an arbitrary error object to UI logs.
  if (error?.type === 'DAppConnectorAPIError' && error?.code === 'Rejected') {
    return 'The wallet request was rejected. No automatic retry was made.';
  }
  return 'This action could not finish. Check your wallet, test network and local proving service. If a transaction was sent, check its status before trying again.';
}
