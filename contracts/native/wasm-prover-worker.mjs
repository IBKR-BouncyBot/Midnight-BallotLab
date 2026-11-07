/** Dedicated local proof execution. Only public asset GETs are allowed here. */
import { check, prove } from '@midnightntwrk/zkir-v3';
import { loadNativeProvingAssets, NATIVE_PROVER_CIRCUITS, nativeProverKeyLocation, proverAssetFailureCode } from './wasm-prover-assets.mjs';

let assets;
let initializing = false;
let running = false;
const MAX_PREIMAGE_BYTES = 64 * 1024 * 1024;
const post = value => globalThis.postMessage(value);
const safeFailure = (id, code) => post({ type: 'failure', id, code });
function exact(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

globalThis.addEventListener('message', async ({ data }) => {
  if (data?.type === 'initialize') {
    if (assets || initializing || !exact(data, ['type', 'assetsUrl'])) { safeFailure(0, 'INVALID_REQUEST'); return; }
    initializing = true;
    try {
      assets = await loadNativeProvingAssets(data.assetsUrl, globalThis.location.href,
        typeof __NATIVE_PROVER_MANIFEST_SHA256__ === 'string' ? __NATIVE_PROVER_MANIFEST_SHA256__ : '',
        () => post({ type: 'progress', stage: 'browser-prover-assets-loading' }));
      post({ type: 'ready' });
    } catch (error) { safeFailure(0, proverAssetFailureCode(error) ?? 'ASSET_INTEGRITY'); }
    finally { initializing = false; }
    return;
  }
  let circuit;
  try { circuit = nativeProverKeyLocation(data?.keyLocation).circuitId; } catch { /* Finite invalid-request response below. */ }
  const lookup = data?.operation === 'lookupKey';
  const valid = exact(data, ['type', 'id', 'operation', 'keyLocation', 'preimage', 'bindingInput'])
    && data.type === 'execute' && Number.isSafeInteger(data.id) && data.id > 0
    && ['check', 'prove', 'lookupKey'].includes(data.operation) && circuit
    && (lookup ? data.preimage === undefined && data.bindingInput === undefined
      : data.preimage instanceof Uint8Array && data.preimage.length > 0 && data.preimage.length <= MAX_PREIMAGE_BYTES)
    && (data.bindingInput === undefined || typeof data.bindingInput === 'bigint');
  if (!valid || !assets || running) { safeFailure(Number.isSafeInteger(data?.id) ? data.id : 0, 'INVALID_REQUEST'); return; }
  running = true;
  try {
    if (lookup) {
      // Public key material only. Structured clone preserves cached buffers;
      // transferring them would detach material needed by subsequent proofs.
      post({ type: 'result', id: data.id, value: await assets.lookupKey(data.keyLocation) });
      return;
    }
    post({ type: 'progress', stage: data.operation === 'check' ? 'browser-prover-checking' : 'browser-prover-proving' });
    // The serialized native preimage itself identifies its circuit. The
    // provider accepts only the exact compiled contract's public key names.
    const provingStage = data.operation === 'check' ? 'browser-prover-checking' : 'browser-prover-proving';
    const scopedAssets = {
      lookupKey: async keyLocation => {
        if (keyLocation !== data.keyLocation) throw new Error('Unexpected native circuit');
        const result = await assets.lookupKey(keyLocation);
        post({ type: 'progress', stage: provingStage });
        return result;
      },
      getParams: async k => {
        if (k !== NATIVE_PROVER_CIRCUITS[circuit]) throw new Error('Unexpected native parameters');
        const result = await assets.getParams(k);
        post({ type: 'progress', stage: provingStage });
        return result;
      },
    };
    const value = data.operation === 'check'
      ? await check(data.preimage, scopedAssets)
      : await prove(data.preimage, scopedAssets, data.bindingInput);
    if (value instanceof Uint8Array) globalThis.postMessage({ type: 'result', id: data.id, value }, [value.buffer]);
    else post({ type: 'result', id: data.id, value });
  } catch (error) { safeFailure(data.id, proverAssetFailureCode(error) ?? 'PROOF_FAILED'); }
  finally {
    data.preimage?.fill(0);
    running = false;
  }
});
// Do not invite initialization until imports (including asynchronous official
// WASM initialization) have completed and the message listener is installed.
post({ type: 'booted' });
