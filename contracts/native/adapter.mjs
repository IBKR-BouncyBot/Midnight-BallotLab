/** Private-input adapter for the native Compact source; no substitute runtime.
 * q is Jubjub's prime subgroup order, NOT the Compact coordinate-field modulus.
 * Primary reference: https://docs.midnight.network/compact/standard-library/exports
 */
export const JUBJUB_SCALAR_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
export const NATIVE_MIN_CANDIDATES = 2;
export const NATIVE_MAX_CANDIDATES = 5;
export const NATIVE_CANDIDATES = NATIVE_MAX_CANDIDATES;
export const NATIVE_CAPACITY = 1024;

export function requireCandidateCount(value) {
  if (!Number.isSafeInteger(value) || value < NATIVE_MIN_CANDIDATES || value > NATIVE_MAX_CANDIDATES) {
    throw new RangeError('Native candidateCount must be an integer from two to five');
  }
  return value;
}

export function requireBytes32(value, name = 'secret') {
  if (!(value instanceof Uint8Array) || value.length !== 32 || value.every(byte => byte === 0)) {
    throw new TypeError(`${name} must be 32 bytes and nonzero`);
  }
  return value;
}

export function requireScalar(value, name = 'scalar', { allowZero = false } = {}) {
  if (typeof value !== 'bigint' || value < (allowZero ? 0n : 1n) || value >= JUBJUB_SCALAR_ORDER) {
    throw new TypeError(`${name} must be a canonical Jubjub subgroup scalar`);
  }
  return value;
}

export function randomSecret32() {
  const value = new Uint8Array(32);
  do { globalThis.crypto.getRandomValues(value); } while (value.every(byte => byte === 0));
  return value;
}

export function randomScalar() {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    bytes[0] &= 0x0f; // Uniform 252-bit integer; reject values outside the subgroup order.
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    if (value > 0n && value < JUBJUB_SCALAR_ORDER) return value;
  }
}

/** Centralized DEMO dealer. It is explicitly not distributed key generation. */
export function createDemoDealer() {
  for (;;) {
    const setupSecret = randomScalar();
    const setupSlope = randomScalar();
    const shares = [1n, 2n, 3n].map(index => (setupSecret + index * setupSlope) % JUBJUB_SCALAR_ORDER);
    if (shares.every(share => share !== 0n)) return {
      setupSecret, setupSlope,
      trustees: shares.map((secretShare, i) => ({ index: BigInt(i + 1), secretShare })),
    };
  }
}

export function freshBallotRandomness() {
  const values = [];
  while (values.length < NATIVE_CANDIDATES) {
    const value = randomScalar();
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

function witness(name, validate) {
  return ({ privateState }) => {
    if (!privateState || !Object.hasOwn(privateState, name)) throw new Error(`Missing native private input: ${name}`);
    return [privateState, validate(privateState[name], name)];
  };
}

/** These callbacks supply private inputs; the Compact circuits enforce validity. */
export const nativeWitnesses = Object.freeze({
  setupSecret: witness('setupSecret', requireScalar),
  setupSlope: witness('setupSlope', requireScalar),
  administratorSecret: witness('administratorSecret', requireBytes32),
  voterSecret: witness('voterSecret', requireBytes32),
  trusteeSecretShare: witness('trusteeSecretShare', requireScalar),
  selection: witness('selection', value => {
    if (typeof value !== 'bigint' || value < 0n || value >= BigInt(NATIVE_CANDIDATES)) throw new TypeError('selection must be a bigint from 0n through 4n');
    return value;
  }),
  ballotRandomness: witness('ballotRandomness', values => {
    if (!Array.isArray(values) || values.length !== NATIVE_CANDIDATES) throw new TypeError('ballotRandomness must contain five scalars');
    values.forEach(value => requireScalar(value, 'ballot randomness'));
    if (new Set(values).size !== NATIVE_CANDIDATES) throw new TypeError('Each candidate requires distinct encryption randomness');
    return values;
  }),
  eligibilityPath: witness('eligibilityPath', path => {
    if (!path || typeof path !== 'object' || !Array.isArray(path.path) || path.path.length !== 10) {
      throw new TypeError('eligibilityPath must be a native depth-10 Merkle path');
    }
    requireBytes32(path.leaf, 'membership leaf');
    return path;
  }),
});

export function pairCoefficients(first, second) {
  if (typeof first !== 'bigint' || typeof second !== 'bigint') throw new TypeError('Native trustee indices must be bigint values');
  const pair = `${first},${second}`;
  if (pair === '1,2') return { first: 2n, second: 1n, scale: 1n };
  if (pair === '1,3') return { first: 3n, second: 1n, scale: 2n };
  if (pair === '2,3') return { first: 3n, second: 2n, scale: 1n };
  throw new RangeError('Choose distinct trustee indices in ascending order: [1,2], [1,3] or [2,3]');
}

export function pointEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 2 && right.length === 2
    && left[0] === right[0] && left[1] === right[1];
}
