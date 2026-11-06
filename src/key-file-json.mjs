/** Shared bounded transport for explicitly selected JSON key/context files.
 * This module never stores or logs file names, contents or read-error payloads. */
import { decodeJsonUtf8, parseStrictJson } from './json.mjs';

export const KEY_FILE_JSON_LIMIT = 4096;

export function parseKeyFileJson(text, fields) {
  const value = parseStrictJson(text, { maxBytes: KEY_FILE_JSON_LIMIT, maxDepth: 2 });
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype
    || !Array.isArray(fields) || new Set(fields).size !== fields.length
    || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))
    || Object.values(value).some(item => item !== null && typeof item === 'object')) throw new TypeError('Invalid key file JSON fields');
  return value;
}

export async function readKeyFileJsonText(file) {
  try {
    if (!file || typeof file.name !== 'string' || !/\.json$/i.test(file.name)
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > KEY_FILE_JSON_LIMIT
      || typeof file.arrayBuffer !== 'function') throw new TypeError('Invalid JSON file');
    const data = await file.arrayBuffer();
    if (!(data instanceof ArrayBuffer) || data.byteLength !== file.size || data.byteLength > KEY_FILE_JSON_LIMIT) throw new TypeError('Invalid JSON file');
    return decodeJsonUtf8(new Uint8Array(data), { maxBytes: KEY_FILE_JSON_LIMIT });
  } catch { throw new TypeError('Could not read a JSON file within the size and UTF-8 limits'); }
}
