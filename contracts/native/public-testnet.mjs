/** Public Preview configuration and read-only service checks.
 * These requests contain no wallet/account data, witnesses or transactions.
 * A successful check is connectivity evidence, not authenticated chain state.
 */
import { protocolVersionToLedger } from '@midnight-ntwrk/midnight-js-protocol/version';

// Observed through the official Preview RPC on 7 November 2026 after its
// ledger-9 reset. A network name/URL alone does not identify a chain. Review
// this pin explicitly after any later reset; never learn it from a wallet.
export const PREVIEW_CHAIN_IDENTITY = Object.freeze({
  networkId: 'preview',
  genesisHash: '0x3c096de209e06a1a8c52be7bda109ee8c891a42288c0a9db5495f9616dd13796',
  ledgerEra: 'v9',
});
export const PREVIEW_PUBLIC_SERVICES = Object.freeze({
  networkId: 'preview',
  nodeRpc: 'https://rpc.preview.midnight.network',
  indexerUri: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWsUri: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  faucetUrl: 'https://midnight-tmnight-preview.nethermind.dev/',
  guideUrl: 'https://docs.midnight.network/guides/networks-and-environments',
});

export function previewBrowserConfiguration({ compiledAssetsUrl = './native-contract' } = {}) {
  if (typeof compiledAssetsUrl !== 'string' || !compiledAssetsUrl.trim()) {
    throw new TypeError('A compiled asset location is required');
  }
  // The existing browser configuration boundary enforces same-origin assets.
  return Object.freeze({ networkId: PREVIEW_PUBLIC_SERVICES.networkId,
    indexerUri: PREVIEW_PUBLIC_SERVICES.indexerUri, indexerWsUri: PREVIEW_PUBLIC_SERVICES.indexerWsUri,
    compiledAssetsUrl });
}

// Only errors created here may supply UI diagnostics. Do not trust error.name,
// message, code or cause from fetch, a wallet, or an arbitrary caller object.
const safeErrorMessages = new WeakMap();
const serviceNames = Object.freeze({ node: 'public Preview node', indexer: 'public Preview indexer', services: 'public Preview node and indexer' });
class PreviewServiceCheckError extends Error {
  constructor(code, service, explanation, httpStatus) {
    const message = `${explanation} This check did not connect a wallet or submit a transaction.`;
    super(message); this.name = 'PreviewServiceCheckError';
    Object.defineProperties(this, {
      code: { value: code, enumerable: true }, service: { value: service, enumerable: true },
      ...(httpStatus === undefined ? {} : { httpStatus: { value: httpStatus, enumerable: true } }),
    });
    safeErrorMessages.set(this, message);
  }
}
/** A known, fixed safe UI message, or null for every unbranded error/object. */
export function formatPreviewServiceError(error) {
  return safeErrorMessages.get(error) ?? null;
}
const unavailable = () => new PreviewServiceCheckError('service-unavailable', 'services', 'The public Preview service check could not start. Try reloading this page.');

function rpcResult(value, id) {
  if (value?.jsonrpc !== '2.0' || value.id !== id || value.error !== undefined) {
    throw new PreviewServiceCheckError('network-identity', 'node', 'The public node returned an invalid chain-identity response. Do not submit a transaction.');
  }
  return value.result;
}
function requireLedger9(version, service) {
  try {
    if (Number.isSafeInteger(version) && protocolVersionToLedger(version, 'construct') === PREVIEW_CHAIN_IDENTITY.ledgerEra) return version;
  } catch { /* Never expose SDK errors or upstream values. */ }
  throw new PreviewServiceCheckError('protocol-version', service, 'The public Preview service did not report the supported ledger-9 protocol. Do not submit a transaction.');
}
function validateExpectedIdentity(value) {
  try {
    const fields = ['networkId', 'genesisHash', 'ledgerEra', 'protocolVersion'];
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(descriptors).length !== fields.length ||
        fields.some(field => !Object.hasOwn(descriptors[field] ?? {}, 'value')) ||
        descriptors.networkId.value !== PREVIEW_CHAIN_IDENTITY.networkId ||
        descriptors.genesisHash.value !== PREVIEW_CHAIN_IDENTITY.genesisHash ||
        descriptors.ledgerEra.value !== PREVIEW_CHAIN_IDENTITY.ledgerEra) throw new Error();
    requireLedger9(descriptors.protocolVersion.value, 'services');
    return descriptors.protocolVersion.value;
  } catch {
    throw new PreviewServiceCheckError('chain-session-changed', 'services', 'The saved session does not identify this Preview chain. Reconnect before continuing; do not retry an uncertain transaction.');
  }
}

/** Validate a public saved identity without a network call. Not a freshness check. */
export function validatePreviewChainIdentity(value) {
  const protocolVersion = validateExpectedIdentity(value);
  return Object.freeze({ ...PREVIEW_CHAIN_IDENTITY, protocolVersion });
}

/** Fresh read-only check, suitable before wallet access and each sensitive step.
 * A previous result may be supplied to reject a changed protocol/session.
 * RPC/indexer agreement is not independently authenticated consensus.
 */
export async function requirePreviewChainIdentity(options = {}, expectedIdentity) {
  const expectedProtocol = expectedIdentity === undefined ? undefined : validateExpectedIdentity(expectedIdentity);
  const { chainIdentity } = await checkPreviewPublicServices(options);
  if (expectedProtocol !== undefined && chainIdentity.protocolVersion !== expectedProtocol) {
    throw new PreviewServiceCheckError('chain-session-changed', 'services', 'The Preview protocol changed during this session. Reconnect before continuing; do not retry an uncertain transaction.');
  }
  return chainIdentity;
}

export async function checkPreviewPublicServices({ fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw unavailable();
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw unavailable();
  const controller = new AbortController();
  let timedOut = false, rejectStopped;
  const pending = new Set(['node', 'indexer']);
  const cancelled = () => controller.abort();
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const onStop = () => {
    const service = pending.size === 1 ? [...pending][0] : 'services';
    rejectStopped(new PreviewServiceCheckError(timedOut ? 'timeout' : 'cancelled', service, timedOut
      ? `The ${serviceNames[service]} did not finish responding within 15 seconds. Check your connection or try again.`
      : `The ${serviceNames[service]} check was cancelled. You can start a new check.`));
  };
  controller.signal.addEventListener('abort', onStop, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancelled, { once: true });
  async function request(service, url, body) {
    if (controller.signal.aborted) return stopped;
    let response;
    try {
      response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch {
      if (controller.signal.aborted) return stopped;
      // Browser fetch does not reliably distinguish CORS, DNS, TLS, an offline
      // device or a blocked connection. Describe possibilities without guessing.
      throw new PreviewServiceCheckError('transport-unavailable', service,
        `Your browser could not reach the ${serviceNames[service]}. Check your connection and browser or network restrictions; the service may also be temporarily unavailable.`);
    }
    if (!response?.ok) {
      const status = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : undefined;
      throw new PreviewServiceCheckError('http-status', service, status === undefined
        ? `The ${serviceNames[service]} returned an unusable HTTP response. Try again shortly.`
        : `The ${serviceNames[service]} returned HTTP ${status}. ${status === 429 ? 'Its request limit was reached; wait before trying again.' : 'Try again shortly.'}`, status);
    }
    try { return await response.json(); }
    catch {
      if (controller.signal.aborted) return stopped;
      throw new PreviewServiceCheckError('invalid-json', service,
        `The ${serviceNames[service]} returned a response that could not be read as JSON. Try again shortly.`);
    }
  }
  try {
    const rpc = (id, method, params = []) => request('node', PREVIEW_PUBLIC_SERVICES.nodeRpc,
      { jsonrpc: '2.0', id, method, params }).then(value => rpcResult(value, id));
    const checks = Promise.all([
      Promise.all([rpc(1, 'system_chain'), rpc(2, 'chain_getBlockHash', [0]), rpc(3, 'state_getRuntimeVersion')]).then(([chainName, genesisHash, runtime]) => {
        if (chainName !== 'Midnight Preview') {
          throw new PreviewServiceCheckError('network-identity', 'node', 'The public node did not identify itself as Midnight Preview. Do not submit a transaction.');
        }
        if (genesisHash !== PREVIEW_CHAIN_IDENTITY.genesisHash) {
          throw new PreviewServiceCheckError('chain-reset', 'node', 'The public Preview genesis does not match this application. The network may have reset. Do not submit or retry a transaction.');
        }
        if (runtime?.specName !== 'midnight') {
          throw new PreviewServiceCheckError('network-identity', 'node', 'The public node did not identify the expected Midnight runtime. Do not submit a transaction.');
        }
        const protocolVersion = requireLedger9(runtime.specVersion, 'node');
        pending.delete('node');
        return { chainName, genesisHash, protocolVersion };
      }),
      request('indexer', PREVIEW_PUBLIC_SERVICES.indexerUri, { query: '{ block { height hash protocolVersion } }' }).then(value => {
        const block = value?.data?.block;
        const height = block?.height;
        if ((value?.errors != null && (!Array.isArray(value.errors) || value.errors.length !== 0))
            || !Number.isSafeInteger(height) || height < 0 || typeof block.hash !== 'string' || !/^[a-f0-9]{64}$/.test(block.hash)) {
          throw new PreviewServiceCheckError('indexer-response', 'indexer', 'The public Preview indexer did not return valid block metadata. Try again shortly.');
        }
        const protocolVersion = requireLedger9(block.protocolVersion, 'indexer');
        pending.delete('indexer');
        return { height, hash: block.hash, protocolVersion };
      }),
    ]);
    const [node, block] = await Promise.race([checks, stopped]);
    if (node.protocolVersion !== block.protocolVersion) {
      throw new PreviewServiceCheckError('protocol-disagreement', 'services', 'The public Preview node and indexer disagree on the current protocol. Wait for them to agree before continuing.');
    }
    pending.add('node');
    const nodeBlockHash = await Promise.race([rpc(4, 'chain_getBlockHash', [block.height]), stopped]);
    if (nodeBlockHash !== `0x${block.hash}`) {
      throw new PreviewServiceCheckError('indexer-chain-mismatch', 'services', 'The public Preview indexer block does not match the pinned node chain. Do not submit a transaction.');
    }
    const chainIdentity = Object.freeze({ ...PREVIEW_CHAIN_IDENTITY, protocolVersion: node.protocolVersion });
    return Object.freeze({ networkId: 'preview', chainName: node.chainName, blockHeight: block.height, blockHash: block.hash,
      chainIdentity, source: 'fixed-public-preview-services', independentlyVerified: false,
      walletConnected: false, proofGenerated: false, transactionSubmitted: false });
  } catch (error) {
    // Transport/JSON/SDK exceptions can include URLs, request bodies or secrets.
    // Keep only our fixed messages and codes; never attach a raw cause.
    if (safeErrorMessages.has(error)) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', onStop);
    controller.abort();
  }
}
