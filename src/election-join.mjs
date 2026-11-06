/** Public election identity transport only. Importing a file does not join a
 * contract, authenticate its source, or replace the SDK's real join checks. */
import { KEY_FILE_JSON_LIMIT, parseKeyFileJson, readKeyFileJsonText } from './key-file-json.mjs';
import { requireDevelopmentNetwork } from '../contracts/native/browser-config.mjs';

export const ELECTION_JOIN_FILE_LIMIT = KEY_FILE_JSON_LIMIT;
const SCHEMA = 'midnight-ballot-lab/election-join/v1';
const FIELDS = ['schema', 'networkId', 'contractAddress', 'configurationDigest'];
const plainObject = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;

function digest(value) {
  if (typeof value !== 'string' || value.length > ELECTION_JOIN_FILE_LIMIT) throw new TypeError('Invalid election address or fingerprint');
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized) || /^0{64}$/.test(normalized)) throw new TypeError('Invalid election address or fingerprint');
  return normalized;
}

function canonical(value) {
  if (!plainObject(value) || Object.keys(value).length !== FIELDS.length
    || FIELDS.some(field => !Object.hasOwn(value, field)) || value.schema !== SCHEMA) throw new TypeError('Invalid election join file fields');
  return Object.freeze({ schema: SCHEMA, ...validateElectionContext(value) });
}

/** Project and validate only public context; callers with a wider schema must
 * separately reject unknown fields before using this shared validator. */
export function validateElectionContext(value) {
  if (!plainObject(value) || FIELDS.slice(1).some(field => !Object.hasOwn(value, field))) throw new TypeError('Election identity is incomplete');
  return Object.freeze({ networkId: requireDevelopmentNetwork(value.networkId),
    contractAddress: digest(value.contractAddress), configurationDigest: digest(value.configurationDigest) });
}

/** Project only these public identifiers; unrelated caller data is never read
 * or serialized. The caller must obtain the fingerprint from configured state. */
export function encodeElectionJoinFile(value) {
  if (!plainObject(value) || FIELDS.slice(1).some(field => !Object.hasOwn(value, field))) throw new TypeError('Election identity is incomplete');
  const publicIdentity = canonical({ schema: SCHEMA, networkId: value.networkId,
    contractAddress: value.contractAddress, configurationDigest: value.configurationDigest });
  return JSON.stringify(publicIdentity, null, 2) + '\n';
}

export function decodeElectionJoinFile(text, expectedNetworkId) {
  requireDevelopmentNetwork(expectedNetworkId);
  const value = canonical(parseKeyFileJson(text, FIELDS));
  if (value.networkId !== expectedNetworkId) throw new TypeError('Election join file belongs to a different network');
  return value;
}

export async function readElectionJoinFile(file, expectedNetworkId) {
  requireDevelopmentNetwork(expectedNetworkId);
  return decodeElectionJoinFile(await readKeyFileJsonText(file), expectedNetworkId);
}
