// Public proving parameters only. Never accepts private inputs or caller URLs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { NATIVE_PROVER_PARAMETERS, NATIVE_PROVER_PARAMETER_BYTES } from '../contracts/native/wasm-prover-assets.mjs';

export const PARAMETER_SOURCE = 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com';
export const PARAMETER_PROVENANCE = 'https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.2/base-crypto/src/data_provider.rs';
export const PARAMETER_DIGESTS = NATIVE_PROVER_PARAMETERS;
export const PARAMETER_SIZES = NATIVE_PROVER_PARAMETER_BYTES;
const MAX_BYTES = 64 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateParameter(k, bytes) {
  if (!Object.hasOwn(PARAMETER_DIGESTS, k) || !(bytes instanceof Uint8Array)
    || bytes.length !== PARAMETER_SIZES[k] || sha256(bytes) !== PARAMETER_DIGESTS[k]) {
    throw new Error('Public proving parameter integrity check failed');
  }
  return Object.freeze({ k: Number(k), path: `params/bls_midnight_2p${k}`, bytes: bytes.length, sha256: PARAMETER_DIGESTS[k] });
}

export async function prepareBrowserProverParameters(root, { fetchImpl = globalThis.fetch } = {}) {
  const directory = join(root, 'artifacts/browser-prover-params');
  await mkdir(directory, { recursive: true });
  const result = new Map();
  for (const [value] of Object.entries(PARAMETER_DIGESTS)) {
    const k = Number(value), filename = `bls_midnight_2p${k}`;
    let bytes;
    try { bytes = await readFile(join(directory, filename)); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Public proving parameter cache is unreadable'); }
    if (bytes) validateParameter(k, bytes); // Corrupt cache fails; never silently replace it.
    else {
      try {
        const response = await fetchImpl(`${PARAMETER_SOURCE}/${filename}`, {
          redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(60_000),
        });
        const size = response.headers.get('content-length');
        if (!response.ok || (size !== null && (!/^[0-9]+$/.test(size) || Number(size) > MAX_BYTES))) {
          throw new Error('Invalid public parameter response');
        }
        const chunks = []; let total = 0;
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > MAX_BYTES) throw new Error('Public parameter is too large');
          chunks.push(chunk);
        }
        bytes = Buffer.concat(chunks);
        // Content-Length may describe compressed transfer bytes; validate the
        // decoded payload by its independently pinned length and digest.
        if (size !== null && !response.headers.get('content-encoding') && bytes.length !== Number(size)) throw new Error('Public parameter length mismatch');
        validateParameter(k, bytes);
        await writeFile(join(directory, filename), bytes, { flag: 'wx' });
      } catch { throw new Error(`Could not prepare the pinned public proving parameter k=${k}`); }
    }
    result.set(k, { record: validateParameter(k, bytes), bytes });
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const parameters = await prepareBrowserProverParameters(root);
    console.log(JSON.stringify({ status: 'passed', scope: 'public parameter download and digest verification only',
      source: PARAMETER_PROVENANCE, parameters: [...parameters.values()].map(item => item.record) }));
  } catch { console.error('Pinned public proving parameters could not be prepared.'); process.exitCode = 1; }
}
