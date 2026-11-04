/** Explicit private key backups. Never use this format for public exports. */
import { requireBytes32 } from '../contracts/native/adapter.mjs';

export const PRIVATE_KEY_FILE_LIMIT = 256;

export function normalizePrivateKey(text) {
  if (typeof text !== 'string' || text.length > PRIVATE_KEY_FILE_LIMIT) throw new TypeError('Invalid private key');
  const key = text.trim();
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new TypeError('Invalid private key');
  requireBytes32(Uint8Array.from(key.match(/../g), value => parseInt(value, 16)));
  return key.toLowerCase();
}

export function privateKeyText(key) {
  return normalizePrivateKey(key) + '\n';
}

export async function readPrivateKeyFile(file) {
  if (!file || !/\.txt$/i.test(file.name) || !Number.isSafeInteger(file.size)
      || file.size < 1 || file.size > PRIVATE_KEY_FILE_LIMIT) throw new TypeError('Invalid private key file');
  const data = await file.arrayBuffer();
  if (data.byteLength < 1 || data.byteLength > PRIVATE_KEY_FILE_LIMIT) throw new TypeError('Invalid private key file');
  return normalizePrivateKey(new TextDecoder('utf-8', { fatal: true }).decode(data));
}
