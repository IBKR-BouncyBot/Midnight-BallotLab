/** Private trustee backup, never a public election export. Loading a file only
 * validates its identity and share; it does not connect or submit anything. */
import { requireScalar, pointEqual } from '../contracts/native/adapter.mjs';
import { validateElectionContext } from './election-join.mjs';
import { parseKeyFileJson, readKeyFileJsonText } from './key-file-json.mjs';

export const TRUSTEE_KEY_FILE_LIMIT = 4096;
const SCHEMA = 'midnight-ballot-lab/trustee-key/v1';
const FIELDS = Object.freeze(['schema', 'networkId', 'contractAddress', 'configurationDigest', 'trusteeIndex', 'secretShare']);
const invalidFile = () => new TypeError('Invalid private trustee key file or election context');

function canonical(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== FIELDS.length
    || FIELDS.some(field => !Object.hasOwn(value, field)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, field), 'value'))
    || value.schema !== SCHEMA) throw invalidFile();
  const context = validateElectionContext(value);
  if (!Number.isInteger(value.trusteeIndex) || value.trusteeIndex < 1 || value.trusteeIndex > 3
    || typeof value.secretShare !== 'string' || !/^[1-9][0-9]{0,76}$/.test(value.secretShare)) throw invalidFile();
  requireScalar(BigInt(value.secretShare));
  return Object.freeze({ schema: SCHEMA, ...context,
    trusteeIndex: value.trusteeIndex, secretShare: value.secretShare });
}

/** Encode only the exact private schema. Extra fields are rejected, not copied. */
export function encodeTrusteeKeyFile(value) {
  try { return JSON.stringify(canonical(value), null, 2) + '\n'; }
  catch { throw invalidFile(); }
}

/** Require the currently configured election, even when the share itself is valid. */
export function decodeTrusteeKeyFile(text, expectedContext) {
  try {
    const expected = validateElectionContext(expectedContext);
    const record = canonical(parseKeyFileJson(text, FIELDS));
    if (record.networkId !== expected.networkId || record.contractAddress !== expected.contractAddress
      || record.configurationDigest !== expected.configurationDigest) throw invalidFile();
    return record;
  } catch { throw invalidFile(); }
}

export async function readTrusteeKeyFile(file, expectedContext) {
  try {
    // Validate the selected election before reading an untrusted private file.
    validateElectionContext(expectedContext);
    return decodeTrusteeKeyFile(await readKeyFileJsonText(file), expectedContext);
  } catch { throw invalidFile(); }
}

/** The caller supplies registered keys from its configured ledger and the actual
 * generated pureCircuits.nativePublicKey. This is a share/key equality check,
 * not authentication of that ledger or independent chain verification. No
 * JavaScript elliptic-curve implementation or replacement arithmetic is used. */
export function assertTrusteeKeyMatches(value, trusteeKeys, nativePublicKey) {
  try {
    const record = canonical(value);
    const point = candidate => Array.isArray(candidate) && candidate.length === 2
      && candidate.every(coordinate => typeof coordinate === 'bigint');
    if (!Array.isArray(trusteeKeys) || trusteeKeys.length !== 3 || !trusteeKeys.every(point)
      || typeof nativePublicKey !== 'function') throw invalidFile();
    const computed = nativePublicKey(requireScalar(BigInt(record.secretShare)));
    if (!point(computed) || !pointEqual(computed, trusteeKeys[record.trusteeIndex - 1])) throw invalidFile();
    return true;
  } catch {
    // Native errors can contain inputs. Never forward their text or cause.
    throw new TypeError('Trustee key does not match the registered trustee public key');
  }
}
