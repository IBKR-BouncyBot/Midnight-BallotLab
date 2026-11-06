/** Official native proving in a same-origin worker, with no HTTP prover. */
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
// Import the package's side-effectful initializer directly. The protocol
// re-export is marked sideEffects:false and can lose initialization when this
// provider is bundled on its own (for example the real browser proof check).
import { CostModel } from '@midnight-ntwrk/ledger-v8';
import { NATIVE_PROVER_CIRCUITS, nativeProverAssetBase } from './wasm-prover-assets.mjs';

const messages = Object.freeze({
  WORKER_UNAVAILABLE: 'This browser could not start its local Midnight prover. Use a current browser and allow this site’s worker and WebAssembly files.',
  ASSET_UNAVAILABLE: 'The public proving files could not be downloaded. Check your connection, then reconnect the wallet to restart the local prover.',
  ASSET_INTEGRITY: 'A public proving file failed its integrity check. Reload the app before trying again.',
  INVALID_REQUEST: 'The local prover rejected an unsupported request. No proof was substituted.',
  QUEUE_LIMIT: 'The local prover is already handling its allowed work. Wait for the current operation to finish.',
  PROOF_FAILED: 'The local Midnight proof could not be completed. No transaction was submitted by the prover.',
  PROOF_TIMEOUT: 'The local proof exceeded its time limit and the worker was stopped. No transaction was submitted by the prover.',
  CANCELLED: 'The local prover was stopped. This does not cancel a transaction already sent to the network.',
});
const failures = new WeakMap();
function failure(code) {
  const safeCode = Object.hasOwn(messages, code) ? code : 'PROOF_FAILED';
  const error = new Error(messages[safeCode]);
  error.name = 'NativeWasmProofError';
  failures.set(error, Object.freeze({ code: safeCode, message: messages[safeCode] }));
  return error;
}
export function nativeWasmProofErrorMessage(error) { return failures.get(error)?.message ?? null; }
export function nativeWasmProofErrorCode(error) { return failures.get(error)?.code ?? null; }

export async function createNativeWasmProofProvider({ compiledAssetsUrl, onStage = () => {}, onProofProgress = () => {} }) {
  const workerUrl = new URL('./native-prover-worker.mjs', import.meta.url);
  nativeProverAssetBase(compiledAssetsUrl, workerUrl);
  const stage = value => { try { onStage(value); } catch { /* A display observer cannot alter proving. */ } };
  const progress = (phase, circuit) => {
    try { onProofProgress(Object.freeze({ phase, ...(circuit ? { circuit } : {}) })); } catch { /* Display only. */ }
  };
  let worker;
  try { worker = new Worker(workerUrl, { type: 'module', name: 'Midnight local prover' }); }
  catch { throw failure('WORKER_UNAVAILABLE'); }
  let closed = false;
  let nextId = 1;
  let active;
  let initialization;
  let queue = Promise.resolve();
  let inFlightJobs = 0;
  let inFlightBytes = 0;
  let proofTransactionActive = false;
  let completedProofs = 0;
  const pending = new Set();
  function stop(code = 'CANCELLED') {
    if (closed) return;
    closed = true;
    worker.terminate();
    const error = failure(code);
    if (initialization) { clearTimeout(initialization.timer); initialization.reject(error); initialization = undefined; }
    if (active) { clearTimeout(active.timer); active.reject(error); active = undefined; }
    for (const item of pending) { item.bytes.fill(0); item.reject(error); }
    pending.clear();
  }
  const ready = new Promise((resolve, reject) => {
    initialization = { resolve, reject, phase: 'boot', timer: setTimeout(() => stop('WORKER_UNAVAILABLE'), 60_000) };
  });
  worker.addEventListener('error', event => { event.preventDefault(); stop('PROOF_FAILED'); });
  worker.addEventListener('messageerror', () => stop('PROOF_FAILED'));
  worker.addEventListener('message', ({ data }) => {
    if (closed) return;
    if (data?.type === 'booted' && initialization?.phase === 'boot') {
      // The worker imports/instantiates real WASM with top-level await. A
      // message sent before its listener exists can be lost during startup.
      clearTimeout(initialization.timer);
      initialization.phase = 'manifest';
      initialization.timer = setTimeout(() => stop('ASSET_UNAVAILABLE'), 190_000);
      stage('browser-prover-booted');
      try { worker.postMessage({ type: 'initialize', assetsUrl: compiledAssetsUrl }); }
      catch { stop('WORKER_UNAVAILABLE'); }
    } else if (data?.type === 'ready' && initialization?.phase === 'manifest') {
      clearTimeout(initialization.timer); initialization.resolve(); initialization = undefined;
      stage('browser-prover-ready');
    } else if (data?.type === 'progress' && ['browser-prover-assets-loading', 'browser-prover-checking', 'browser-prover-proving'].includes(data.stage)) {
      stage(data.stage);
      progress(data.stage === 'browser-prover-assets-loading' ? 'loading' : data.stage === 'browser-prover-checking' ? 'checking' : 'proving', active?.circuit);
    } else if (data?.type === 'failure') {
      stop(Object.hasOwn(messages, data.code) ? data.code : 'PROOF_FAILED');
    } else if (data?.type === 'result' && active && data.id === active.id) {
      const valid = active.operation === 'prove' ? data.value instanceof Uint8Array && data.value.length > 0
        : Array.isArray(data.value) && data.value.every(value => value === undefined || typeof value === 'bigint');
      if (!valid) { stop('PROOF_FAILED'); return; }
      if (active.operation === 'prove') completedProofs++;
      clearTimeout(active.timer); active.resolve(data.value); active = undefined;
    } else stop('PROOF_FAILED');
  });
  progress('loading');
  await ready;

  function execute(operation, serializedPreimage, keyLocation, bindingInput) {
    if (closed) return Promise.reject(failure('CANCELLED'));
    if (!(serializedPreimage instanceof Uint8Array) || serializedPreimage.length < 1 || serializedPreimage.length > 64 * 1024 * 1024
        || !Object.hasOwn(NATIVE_PROVER_CIRCUITS, keyLocation)
        || (bindingInput !== undefined && typeof bindingInput !== 'bigint')) return Promise.reject(failure('INVALID_REQUEST'));
    if (inFlightJobs >= 8 || inFlightBytes + serializedPreimage.length > 128 * 1024 * 1024) {
      return Promise.reject(failure('QUEUE_LIMIT'));
    }
    // Transfer a copy, leaving the ledger-owned input intact. Pending copies
    // remain memory-only and are cleared if the session closes before use.
    const bytes = serializedPreimage.slice();
    const byteLength = bytes.length;
    inFlightJobs++;
    inFlightBytes += byteLength;
    return new Promise((resolve, reject) => {
      const item = { bytes, reject };
      pending.add(item);
      const run = async () => {
        if (closed) { bytes.fill(0); throw failure('CANCELLED'); }
        pending.delete(item);
        return new Promise((resolveJob, rejectJob) => {
          const id = nextId++;
          active = { id, operation, circuit: keyLocation, resolve: resolveJob, reject: rejectJob,
            timer: setTimeout(() => stop('PROOF_TIMEOUT'), 15 * 60 * 1000) };
          try { worker.postMessage({ type: 'execute', id, operation, keyLocation, preimage: bytes, bindingInput }, [bytes.buffer]); }
          catch { bytes.fill(0); stop('PROOF_FAILED'); }
        });
      };
      const job = queue.then(run);
      queue = job.catch(() => {});
      job.then(resolve, reject).finally(() => { inFlightJobs--; inFlightBytes -= byteLength; });
    });
  }
  const provingProvider = Object.freeze({
    check: (preimage, location) => execute('check', preimage, location),
    prove: (preimage, location, binding) => execute('prove', preimage, location, binding),
  });
  let provider;
  try { provider = createProofProvider(provingProvider, CostModel.initialCostModel()); }
  catch {
    // Initialization can fail after the worker is ready but before a session
    // is returned to its owner. Do not leave that worker alive or leak the
    // ledger exception through a caller that has nothing available to close.
    stop('WORKER_UNAVAILABLE');
    throw failure('WORKER_UNAVAILABLE');
  }
  return Object.freeze({
    provingProvider,
    async proveTx(transaction, options) {
      if (closed) throw failure('CANCELLED');
      if (proofTransactionActive) throw failure('QUEUE_LIMIT');
      proofTransactionActive = true;
      const before = completedProofs;
      try {
        const result = await provider.proveTx(transaction, options);
        // A deployment can contain no circuit calls. Provider completion alone
        // must never be displayed as a newly generated cryptographic proof.
        progress(completedProofs > before ? 'complete' : 'prepared');
        return result;
      } catch (error) {
        if (nativeWasmProofErrorMessage(error)) throw error;
        stop('PROOF_FAILED');
        throw failure('PROOF_FAILED');
      } finally { proofTransactionActive = false; }
    },
    close: () => stop('CANCELLED'),
  });
}
