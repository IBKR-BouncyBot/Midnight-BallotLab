/** Public Preview configuration and read-only service checks.
 * These requests contain no wallet/account data, witnesses or transactions.
 * A successful check is connectivity evidence, not authenticated chain state.
 */
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

class PreviewServiceCheckError extends Error {
  constructor(code, message) { super(message); this.name = 'PreviewServiceCheckError'; this.code = code; }
}
const unavailable = () => new PreviewServiceCheckError('service-unavailable', 'The public Preview services could not be checked. No wallet was connected or transaction submitted.');

export async function checkPreviewPublicServices({ fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw unavailable();
  if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw unavailable();
  const controller = new AbortController();
  let timedOut = false, rejectStopped;
  const cancelled = () => controller.abort();
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const onStop = () => rejectStopped(new PreviewServiceCheckError(timedOut ? 'timeout' : 'cancelled', timedOut
    ? 'The public Preview service check timed out. No transaction was submitted.'
    : 'The public Preview service check was cancelled. No transaction was submitted.'));
  controller.signal.addEventListener('abort', onStop, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancelled, { once: true });
  async function request(url, body) {
    if (controller.signal.aborted) return stopped;
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error',
      cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!response?.ok) throw unavailable();
    return response.json();
  }
  try {
    const checks = Promise.all([
      request(PREVIEW_PUBLIC_SERVICES.nodeRpc, { jsonrpc: '2.0', id: 1, method: 'system_chain', params: [] }).then(value => {
        if (value?.jsonrpc !== '2.0' || value.id !== 1 || value.error !== undefined || value.result !== 'Midnight Preview') {
          throw new PreviewServiceCheckError('network-identity', 'The node did not identify itself as Midnight Preview. Do not submit a transaction.');
        }
        return value.result;
      }),
      request(PREVIEW_PUBLIC_SERVICES.indexerUri, { query: '{ block { height } }' }).then(value => {
        const height = value?.data?.block?.height;
        if ((value?.errors != null && (!Array.isArray(value.errors) || value.errors.length !== 0))
            || !Number.isSafeInteger(height) || height < 0) {
          throw new PreviewServiceCheckError('indexer-response', 'The Preview indexer did not return a valid block height. No transaction was submitted.');
        }
        return height;
      }),
    ]);
    const [chainName, blockHeight] = await Promise.race([checks, stopped]);
    return Object.freeze({ networkId: 'preview', chainName, blockHeight, source: 'fixed-public-preview-services',
      walletConnected: false, proofGenerated: false, transactionSubmitted: false });
  } catch (error) {
    // Transport/JSON/SDK exceptions can include URLs, request bodies or secrets.
    // Keep only our fixed messages and codes; never attach a raw cause.
    if (error instanceof PreviewServiceCheckError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancelled);
    controller.signal.removeEventListener('abort', onStop);
    controller.abort();
  }
}
