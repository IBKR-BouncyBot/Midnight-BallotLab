/** Independent public-record consistency checks using the real Midnight runtime.
 * Imported coordinates are untrusted. constructJubjubPoint alone is NOT validation.
 * The pinned WASM ecMul decoder rejects invalid curve points. We additionally
 * require exact coordinate round-trip and [q-1]P + P = identity using native WASM.
 * Source: midnight-ledger tag onchain-runtime-3.0.0,
 * onchain-runtime-wasm/src/primitives.rs; transient-crypto/src/{fab,curve}.rs.
 * No private state, witness, wallet, proof-generation or network API is used.
 */
import * as RT from '@midnight-ntwrk/compact-runtime';
import { pureCircuits } from '../managed/native-election/contract/index.js';
import { JUBJUB_SCALAR_ORDER, NATIVE_CAPACITY, pairCoefficients, pointEqual } from './adapter.mjs';
import { parseStrictJson } from '../../src/json.mjs';

const SNAPSHOT_SCHEMA = 'midnight-ballot-lab/native-emulator-public/v2';
const MANIFEST_SCHEMA = 'midnight-ballot-lab/native-demo-manifest/v2';
const RECEIPT_SCHEMA = 'midnight-ballot-lab/native-emulator-receipt/v1';
const WARNING = 'Public emulator snapshot only. It contains no native ZK proof or authenticated chain state and cannot establish election legitimacy independently.';
const MANIFEST_FIELDS = ['schema', 'execution', 'electionId', 'title', 'candidates', 'threshold', 'capacity', 'syntheticVoters', 'timingMode', 'durationSeconds', 'opensAt', 'closesAt'];
const SNAPSHOT_FIELDS = ['schema', 'execution', 'network', 'proofGenerated', 'ledgerInclusionVerified', 'warning',
  'contractAddress', 'electionId', 'manifestDigest', 'configurationDigest', 'keysConfigured',
  'administrator', 'opensAt', 'closesAt', 'candidateCount', 'phase', 'accepted', 'publicKey', 'coefficientKey',
  'trusteeKeys', 'aggregateA', 'aggregateB', 'ballots', 'decryptionShares', 'finalizedTotals', 'manifest'];
const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
const MAX_FIELD = RT.maxField();
const IDENTITY = RT.ecMulGenerator(0n);
const IDENTITY_PAIR = [IDENTITY.x, IDENTITY.y];
const MAX_LANES = 5;
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g), byte => Number.parseInt(byte, 16));

function requireThat(condition) {
  if (!condition) throw new Error('Invalid public record');
}
function exactObject(value, required, optional = []) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  requireThat(keys.every(key => typeof key === 'string' && (required.includes(key) || optional.includes(key)))
    && required.every(key => Object.hasOwn(descriptors, key))
    && keys.every(key => Object.hasOwn(descriptors[key], 'value')));
}
function integer(value, minimum, maximum) {
  requireThat(Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum);
  return value;
}
function digest(value) {
  requireThat(typeof value === 'string' && HEX32.test(value));
  return value;
}
function decimal(value, maximum) {
  requireThat(typeof value === 'string' && DECIMAL.test(value));
  const number = BigInt(value);
  requireThat(number <= maximum);
  return number;
}
function vector(value, size) {
  requireThat(Array.isArray(value) && value.length === size && Object.keys(value).length === size);
  return value;
}
function publicLabel(value, maximum) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
  return value;
}
function canonicalManifest(manifest) {
  exactObject(manifest, MANIFEST_FIELDS);
  requireThat(manifest.schema === MANIFEST_SCHEMA && manifest.execution === 'emulator');
  digest(manifest.electionId);
  publicLabel(manifest.title, 120);
  requireThat(Array.isArray(manifest.candidates));
  integer(manifest.candidates.length, 2, MAX_LANES);
  vector(manifest.candidates, manifest.candidates.length).forEach(label => publicLabel(label, 80));
  requireThat(new Set(manifest.candidates).size === manifest.candidates.length);
  requireThat(manifest.threshold === 2 && manifest.capacity === NATIVE_CAPACITY);
  integer(manifest.syntheticVoters, 1, NATIVE_CAPACITY);
  requireThat(manifest.timingMode === 'manual' || manifest.timingMode === 'scheduled');
  integer(manifest.durationSeconds, 15, 3600);
  requireThat(manifest.timingMode !== 'manual' || manifest.durationSeconds === 600);
  integer(manifest.opensAt, 1, Number.MAX_SAFE_INTEGER);
  integer(manifest.closesAt, manifest.opensAt + 1, Number.MAX_SAFE_INTEGER);
  requireThat(manifest.closesAt - manifest.opensAt === manifest.durationSeconds);
  return Object.fromEntries(MANIFEST_FIELDS.map(field => [field, manifest[field]]));
}

/** External metadata commitment; Compact binds this digest in configurationDigestFor. */
export async function nativeManifestDigest(manifest) {
  const canonical = canonicalManifest(manifest);
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify(canonical))));
}

/** Validate imported coordinates with official WASM before generated pure helpers. */
export function validateNativePublicPoint(value, { nonIdentity = false } = {}) {
  try {
    vector(value, 2);
    const x = decimal(value[0], MAX_FIELD), y = decimal(value[1], MAX_FIELD);
    const point = RT.constructJubjubPoint(x, y);
    const roundTrip = RT.ecMul(point, 1n);
    requireThat(roundTrip.x === x && roundTrip.y === y);
    const subgroup = RT.ecAdd(RT.ecMul(point, JUBJUB_SCALAR_ORDER - 1n), point);
    requireThat(subgroup.x === IDENTITY.x && subgroup.y === IDENTITY.y);
    requireThat(!nonIdentity || x !== IDENTITY.x || y !== IDENTITY.y);
    return [x, y];
  } catch {
    throw new Error('Invalid native public point');
  }
}

/**
 * Verify a JSON export without an existing election session or private credentials.
 * A matching receipt anchors its public context, not eligibility or chain state.
 * Throws a fixed stage message only; untrusted input/runtime payloads are withheld.
 */
export async function verifyNativePublicSnapshot(jsonText, { receipt = null, expectedConfigurationDigest = null } = {}) {
  let stage = 'JSON';
  try {
    requireThat(typeof jsonText === 'string');
    const snapshot = parseStrictJson(jsonText, { maxBytes: 8 * 1024 * 1024, maxDepth: 16 });
    stage = 'schema';
    exactObject(snapshot, SNAPSHOT_FIELDS);
    requireThat(snapshot.schema === SNAPSHOT_SCHEMA && snapshot.execution === 'generated-contract-emulator'
      && snapshot.network === null && snapshot.proofGenerated === false
      && snapshot.ledgerInclusionVerified === false && snapshot.keysConfigured === true
      && snapshot.warning === WARNING);
    for (const field of ['contractAddress', 'electionId', 'manifestDigest', 'configurationDigest', 'administrator']) digest(snapshot[field]);
    for (const field of ['electionId', 'manifestDigest', 'administrator']) requireThat(snapshot[field] !== '00'.repeat(32));
    const candidateCount = integer(snapshot.candidateCount, 2, MAX_LANES);
    const accepted = integer(snapshot.accepted, 0, NATIVE_CAPACITY);
    const phase = integer(snapshot.phase, 0, 3);
    const opening = decimal(snapshot.opensAt, BigInt(Number.MAX_SAFE_INTEGER));
    const closing = decimal(snapshot.closesAt, BigInt(Number.MAX_SAFE_INTEGER));
    requireThat(opening > 0n && closing > opening);
    vector(snapshot.ballots, accepted);
    requireThat(Array.isArray(snapshot.decryptionShares) && snapshot.decryptionShares.length <= 3);
    vector(snapshot.finalizedTotals, MAX_LANES).forEach(value => integer(value, 0, accepted));
    requireThat(snapshot.finalizedTotals.slice(candidateCount).every(total => total === 0));
    requireThat(phase !== 0 || accepted === 0);
    requireThat(phase >= 2 || snapshot.decryptionShares.length === 0);
    requireThat(phase === 3 || snapshot.finalizedTotals.every(total => total === 0));
    requireThat(phase !== 3 || snapshot.decryptionShares.length >= 2);

    stage = 'manifest';
    const manifest = canonicalManifest(snapshot.manifest);
    requireThat(manifest.electionId === snapshot.electionId && manifest.candidates.length === candidateCount
      && BigInt(manifest.opensAt) === opening && BigInt(manifest.closesAt) === closing
      && accepted <= manifest.syntheticVoters);
    requireThat(hex(await nativeManifestDigest(manifest)) === snapshot.manifestDigest);

    stage = 'points';
    const pointCache = new Map();
    const point = (value, nonIdentity = false) => {
      vector(value, 2);
      value.forEach(coordinate => decimal(coordinate, MAX_FIELD));
      const cacheKey = value.join(',');
      let checked = pointCache.get(cacheKey);
      if (!checked) {
        checked = validateNativePublicPoint(value);
        pointCache.set(cacheKey, checked);
      }
      requireThat(!nonIdentity || !pointEqual(checked, IDENTITY_PAIR));
      return checked;
    };
    const points = (value, size = MAX_LANES, nonIdentity = false) => vector(value, size).map(item => point(item, nonIdentity));
    const publicKey = point(snapshot.publicKey, true), coefficientKey = point(snapshot.coefficientKey, true);
    const trusteeKeys = points(snapshot.trusteeKeys, 3, true);
    const aggregateA = points(snapshot.aggregateA), aggregateB = points(snapshot.aggregateB);
    const ballots = [];
    for (let index = 0; index < snapshot.ballots.length; index++) {
      const ballot = snapshot.ballots[index];
      exactObject(ballot, ['index', 'a', 'b', 'nullifier', 'receipt']);
      requireThat(ballot.index === index);
      digest(ballot.nullifier); digest(ballot.receipt);
      const a = points(ballot.a, MAX_LANES, true), b = points(ballot.b);
      requireThat(new Set(a.map(value => value.join(','))).size === MAX_LANES);
      ballots.push({ index, a, b, nullifier: ballot.nullifier, receipt: ballot.receipt });
      if (index % 16 === 15) await new Promise(resolve => setTimeout(resolve, 0));
    }
    let lastTrustee = 0;
    const shares = snapshot.decryptionShares.map(share => {
      exactObject(share, ['index', 'values']);
      integer(share.index, 1, 3);
      requireThat(share.index > lastTrustee);
      lastTrustee = share.index;
      return { index: share.index, values: points(share.values) };
    });

    stage = 'key relations';
    for (let i = 0; i < 3; i++) {
      requireThat(pointEqual(trusteeKeys[i], pureCircuits.addPoints(publicKey,
        pureCircuits.scalePoint(coefficientKey, BigInt(i + 1)))));
    }

    stage = 'configuration';
    const configuration = pureCircuits.configurationDigestFor(bytes(snapshot.electionId), bytes(snapshot.manifestDigest),
      bytes(snapshot.administrator), opening, closing, BigInt(candidateCount), publicKey, coefficientKey, trusteeKeys);
    requireThat(hex(configuration) === snapshot.configurationDigest);
    if (expectedConfigurationDigest !== null) {
      digest(expectedConfigurationDigest);
      requireThat(expectedConfigurationDigest === snapshot.configurationDigest);
    }

    stage = 'ballots';
    const nullifiers = new Set(), receipts = new Set();
    let sumA = Array.from({ length: MAX_LANES }, () => IDENTITY_PAIR);
    let sumB = Array.from({ length: MAX_LANES }, () => IDENTITY_PAIR);
    for (const ballot of ballots) {
      requireThat(!nullifiers.has(ballot.nullifier) && !receipts.has(ballot.receipt));
      nullifiers.add(ballot.nullifier); receipts.add(ballot.receipt);
      const expected = pureCircuits.receiptDigest(bytes(snapshot.electionId), configuration,
        bytes(ballot.nullifier), ballot.a, ballot.b);
      requireThat(hex(expected) === ballot.receipt);
      sumA = sumA.map((total, lane) => pureCircuits.addPoints(total, ballot.a[lane]));
      sumB = sumB.map((total, lane) => pureCircuits.addPoints(total, ballot.b[lane]));
      if (ballot.index % 32 === 31) await new Promise(resolve => setTimeout(resolve, 0));
    }
    stage = 'aggregate';
    requireThat(sumA.every((value, lane) => pointEqual(value, aggregateA[lane]))
      && sumB.every((value, lane) => pointEqual(value, aggregateB[lane])));

    stage = 'tally';
    const checkedPairs = [];
    if (phase === 3) {
      requireThat(snapshot.finalizedTotals.reduce((sum, total) => sum + total, 0) === accepted);
      for (let i = 0; i < shares.length; i++) for (let j = i + 1; j < shares.length; j++) {
        const first = shares[i], second = shares[j];
        const coefficients = pairCoefficients(BigInt(first.index), BigInt(second.index));
        for (let lane = 0; lane < MAX_LANES; lane++) {
          const left = pureCircuits.addPoints(pureCircuits.scalePoint(aggregateB[lane], coefficients.scale),
            pureCircuits.scalePoint(second.values[lane], coefficients.second));
          const right = pureCircuits.addPoints(pureCircuits.nativePublicKey(BigInt(snapshot.finalizedTotals[lane]) * coefficients.scale),
            pureCircuits.scalePoint(first.values[lane], coefficients.first));
          requireThat(pointEqual(left, right));
        }
        checkedPairs.push([first.index, second.index]);
      }
    }

    stage = 'receipt';
    let receiptMatched = null;
    if (receipt !== null) {
      exactObject(receipt, ['schema', 'execution', 'network', 'contractAddress', 'electionId',
        'configurationDigest', 'index', 'receipt'], ['proofGenerated', 'ledgerInclusionVerified']);
      requireThat(receipt.schema === RECEIPT_SCHEMA && receipt.execution === snapshot.execution && receipt.network === null
        && receipt.contractAddress === snapshot.contractAddress && receipt.electionId === snapshot.electionId
        && receipt.configurationDigest === snapshot.configurationDigest);
      for (const field of ['proofGenerated', 'ledgerInclusionVerified']) {
        requireThat(!Object.hasOwn(receipt, field) || receipt[field] === false);
      }
      integer(receipt.index, 0, accepted - 1); digest(receipt.receipt);
      requireThat(ballots[receipt.index].receipt === receipt.receipt);
      receiptMatched = true;
    }

    return {
      valid: true, scope: 'public-snapshot-consistency', snapshot, finalized: phase === 3,
      accepted, candidateCount, totals: phase === 3 ? snapshot.finalizedTotals.slice(0, candidateCount) : null,
      checkedPairs, receiptMatched,
      checks: { schema: true, nativePoints: true, manifestDigest: true, configurationDigest: true, keyRelations: true,
        nullifierUniqueness: true, receiptUniqueness: true, receiptDigests: true, aggregate: true,
        thresholdTally: phase === 3 ? true : null, expectedConfiguration: expectedConfigurationDigest === null ? null : true },
      proofVerified: false, eligibilityVerified: false, trusteeContributionsAuthenticated: false,
      chainInclusionVerified: false, electionFairnessEstablished: false,
      limitations: [
        'Checks consistency of the supplied public record, not an authenticated election.',
        'No ballot eligibility proof, ciphertext well-formedness proof or trustee share proof is included in this snapshot.',
        'An internally consistent replacement record can pass; compare the configuration and your receipt through an independently trusted channel.',
        'These checks do not establish honest enrollment, omission resistance, cast-as-intended voting, chain inclusion or election fairness.',
      ],
    };
  } catch {
    throw new Error(`Public snapshot validation failed (${stage})`);
  }
}

