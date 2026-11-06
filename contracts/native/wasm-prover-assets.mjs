/** Public proving assets only. Private preimages never enter an HTTP request. */
import { decodeJsonUtf8, parseStrictJson } from '../../src/json.mjs';

export const NATIVE_PROVER_CIRCUITS = Object.freeze({
  configureKeys: 16, enroll: 13, openVoting: 7, castBallot: 17,
  closeVoting: 7, submitDecryption: 13, finalize: 15,
});
// Official ledger-8.1.2/base-crypto/src/data_provider.rs. These are public
// structured-reference parameters, not user witnesses or wallet information.
export const NATIVE_PROVER_PARAMETERS = Object.freeze({
  7: 'e82ae890c080188355f37feaffe91372584cd810615082d9143d4dec0453fd9d',
  13: 'd3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803',
  15: '724c7c3d779148bb113c7ee9c034b2f27db16e6bdf315fde90105a9bad00b1de',
  16: '09c877216d6589b370263e18af40a030a901b41a7a7c37ef58c9901db41f05c6',
  17: '4a9ef6c7c0619aab74eede44b13e753e3ba54508a02dd3b7106a949aabb73b74',
});
export const NATIVE_PROVER_PARAMETER_BYTES = Object.freeze({
  7: 24964, 13: 1573252, 15: 6291844, 16: 12583300, 17: 25166212,
});
export const NATIVE_PROVER_ASSET_SCHEMA = 'midnight-ballot-lab/browser-prover-assets/v1';
const MAX_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const failures = new WeakMap();

function fail(code) {
  const error = new Error('Browser proving assets are unavailable or invalid');
  failures.set(error, code);
  throw error;
}
export function proverAssetFailureCode(error) { return failures.get(error) ?? null; }
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) fail('ASSET_INTEGRITY');
}
function record(value, path) {
  exact(value, ['path', 'bytes', 'sha256']);
  if (value.path !== path || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_ASSET_BYTES
      || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) fail('ASSET_INTEGRITY');
  return Object.freeze({ path, bytes: value.bytes, sha256: value.sha256 });
}
export function validateNativeProverManifest(value) {
  exact(value, ['schema', 'proverVersion', 'circuits', 'params']);
  if (value.schema !== NATIVE_PROVER_ASSET_SCHEMA || value.proverVersion !== '2.1.1'
      || !Array.isArray(value.circuits) || value.circuits.length !== Object.keys(NATIVE_PROVER_CIRCUITS).length
      || !Array.isArray(value.params) || value.params.length !== Object.keys(NATIVE_PROVER_PARAMETERS).length) fail('ASSET_INTEGRITY');
  const circuits = new Map();
  for (const item of value.circuits) {
    exact(item, ['name', 'k', 'prover', 'verifier', 'ir']);
    if (!Object.hasOwn(NATIVE_PROVER_CIRCUITS, item.name) || circuits.has(item.name)
        || item.k !== NATIVE_PROVER_CIRCUITS[item.name]) fail('ASSET_INTEGRITY');
    circuits.set(item.name, Object.freeze({ name: item.name, k: item.k,
      prover: record(item.prover, `keys/${item.name}.prover`),
      verifier: record(item.verifier, `keys/${item.name}.verifier`),
      ir: record(item.ir, `zkir/${item.name}.bzkir`),
    }));
  }
  const params = new Map();
  for (const item of value.params) {
    exact(item, ['k', 'path', 'bytes', 'sha256']);
    if (!Number.isInteger(item.k) || !Object.hasOwn(NATIVE_PROVER_PARAMETERS, item.k) || params.has(item.k)
        || item.sha256 !== NATIVE_PROVER_PARAMETERS[item.k] || item.bytes !== NATIVE_PROVER_PARAMETER_BYTES[item.k]) fail('ASSET_INTEGRITY');
    params.set(item.k, record({ path: item.path, bytes: item.bytes, sha256: item.sha256 }, `params/bls_midnight_2p${item.k}`));
  }
  return { circuits, params };
}

export function nativeProverAssetBase(value, workerUrl) {
  let base, worker;
  try { base = new URL(value); worker = new URL(workerUrl); } catch { fail('ASSET_INTEGRITY'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== worker.origin || base.username || base.password
      || base.search || base.hash || base.pathname.endsWith('/')) fail('ASSET_INTEGRITY');
  return base;
}

async function fetchBytes(url, maxBytes, exactBytes) {
  let response;
  try { response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(180_000) }); }
  catch { fail('ASSET_UNAVAILABLE'); }
  if (!response.ok || !response.body) fail('ASSET_UNAVAILABLE');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) fail('ASSET_INTEGRITY');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); fail('ASSET_INTEGRITY'); }
      chunks.push(value);
    }
  } catch (error) { if (proverAssetFailureCode(error)) throw error; fail('ASSET_UNAVAILABLE'); }
  finally { reader.releaseLock(); }
  if (total < 1 || (exactBytes !== undefined && total !== exactBytes)) fail('ASSET_INTEGRITY');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function loadNativeProvingAssets(compiledAssetsUrl, workerUrl, expectedManifestSha256, onAsset = () => {}) {
  const base = nativeProverAssetBase(compiledAssetsUrl, workerUrl);
  if (typeof expectedManifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedManifestSha256)) fail('ASSET_INTEGRITY');
  let manifest;
  try {
    const bytes = await fetchBytes(`${base.href}/prover-manifest.json`, MAX_MANIFEST_BYTES);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
    if (hex !== expectedManifestSha256) fail('ASSET_INTEGRITY');
    manifest = validateNativeProverManifest(parseStrictJson(decodeJsonUtf8(bytes), { maxBytes: MAX_MANIFEST_BYTES, maxDepth: 8 }));
  } catch (error) { if (proverAssetFailureCode(error)) throw error; fail('ASSET_INTEGRITY'); }
  const cache = new Map();
  async function asset(description) {
    if (!cache.has(description.path)) {
      const pending = (async () => {
        onAsset();
        const bytes = await fetchBytes(`${base.href}/${description.path}`, description.bytes, description.bytes);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const hex = Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
        if (hex !== description.sha256) fail('ASSET_INTEGRITY');
        return bytes;
      })();
      cache.set(description.path, pending);
      pending.catch(() => cache.delete(description.path));
    }
    return cache.get(description.path);
  }
  return Object.freeze({
    async lookupKey(keyLocation) {
      const circuit = manifest.circuits.get(keyLocation);
      if (!circuit) fail('INVALID_REQUEST');
      const [proverKey, verifierKey, ir] = await Promise.all([asset(circuit.prover), asset(circuit.verifier), asset(circuit.ir)]);
      return { proverKey, verifierKey, ir };
    },
    async getParams(k) {
      const parameter = manifest.params.get(k);
      if (!parameter) fail('INVALID_REQUEST');
      return asset(parameter);
    },
  });
}
