/** Test tooling: bind every emitted ESM chunk without accepting arbitrary paths. */
import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
function fail() { throw new Error('Browser module asset integrity check failed'); }
export function validateBrowserModuleAssets(records, prefix = 'network') {
  if (!['network', 'proof-check'].includes(prefix) || !Array.isArray(records) || records.length < 1 || records.length > 32) fail();
  const pattern = new RegExp(`^${prefix}-chunk-[A-Z0-9]{8}\\.mjs$`), seen = new Set();
  return Object.freeze(records.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).length !== 3 || !['path', 'bytes', 'sha256'].every(key => Object.hasOwn(record, key))
      || typeof record.path !== 'string' || !pattern.test(record.path) || seen.has(record.path)
      || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > 16 * 1024 * 1024
      || typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) fail();
    seen.add(record.path); return Object.freeze({ path: record.path, bytes: record.bytes, sha256: record.sha256 });
  }));
}
export async function verifyBrowserModuleAssets(directory, records, prefix = 'network') {
  const validated = validateBrowserModuleAssets(records, prefix), root = await realpath(directory);
  for (const record of validated) {
    const file = await realpath(resolve(root, record.path));
    if (dirname(file) !== root) fail();
    const bytes = await readFile(file);
    if (bytes.length !== record.bytes || createHash('sha256').update(bytes).digest('hex') !== record.sha256) fail();
  }
  return validated;
}

// Measured initialized graph after SDK 5 ESM splitting: the v8 compatibility
// WASMs remain packaged but are not fetched by the v9 application bootstrap.
export function initialNetworkWasmAssets(paths) {
  if (!Array.isArray(paths)) fail();
  const expected = [
    'network-assets/midnight_ledger_wasm_v9_bg-78a1446356f3c100ddede1d6a58019ef8152eb90da85aab55736a85cca5aece4.wasm',
    'network-assets/midnight_onchain_runtime_wasm_bg-a10579365a8bf303abdcedef906f4bdf4a159f189f19c86c654bd75d0a0c870d.wasm',
  ];
  if (expected.some(path => paths.filter(value => value === path).length !== 1)) fail();
  return Object.freeze(expected);
}
