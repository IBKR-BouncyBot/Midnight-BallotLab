/** Public ledger projection only. It verifies neither ZK proofs nor chain inclusion.
 * Deliberately allowlists every exported field; private state and proofData never
 * cross this boundary. Imported snapshots must not be treated as authenticated.
 */
import { NATIVE_CAPACITY } from './adapter.mjs';

const bytesHex = value => {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new TypeError('Expected native Bytes<32> in ledger export');
  return [...value].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const pointJson = point => {
  if (!Array.isArray(point) || point.length !== 2 || point.some(value => typeof value !== 'bigint')) throw new TypeError('Expected native coordinate pair');
  return point.map(value => value.toString());
};
const pointsJson = points => {
  if (!Array.isArray(points) || points.length !== 3) throw new TypeError('Expected three native coordinate pairs');
  return points.map(pointJson);
};

/** Allowlisted PUBLIC ledger fields only. This is not a portable ZK proof. */
export function projectNativePublicLedger(state, { contractAddress }) {
  if (typeof contractAddress !== 'string' || !/^[0-9a-f]{64}$/.test(contractAddress)) throw new TypeError('Invalid emulator contract address');
  if (typeof state.accepted !== 'bigint' || state.accepted < 0n || state.accepted > BigInt(NATIVE_CAPACITY)) throw new Error('Native ballot count exceeds capacity');
  const ballots = [];
  for (let index = 0n; index < state.accepted; index++) {
    const a = state.ballotA.lookup(index), b = state.ballotB.lookup(index);
    const nullifier = state.nullifiers.lookup(index), receipt = state.ballotReceipts.lookup(index);
    ballots.push({ index: Number(index), a: pointsJson(a), b: pointsJson(b), nullifier: bytesHex(nullifier), receipt: bytesHex(receipt) });
  }
  const decryptionShares = [];
  for (const index of [1n, 2n, 3n]) {
    if (state.decryptionShares.member(index)) decryptionShares.push({ index: Number(index), values: pointsJson(state.decryptionShares.lookup(index)) });
  }
  return {
    schema: 'midnight-ballot-lab/native-emulator-public/v1',
    execution: 'generated-contract-emulator', network: null,
    proofGenerated: false, ledgerInclusionVerified: false,
    warning: 'Public emulator snapshot only. It contains no native ZK proof or authenticated chain state and cannot establish election legitimacy independently.',
    contractAddress,
    electionId: bytesHex(state.electionId), manifestDigest: bytesHex(state.manifestDigest),
    configurationDigest: bytesHex(state.configurationDigest), keysConfigured: state.keysConfigured,
    administrator: bytesHex(state.administrator), opensAt: state.opensAt.toString(), closesAt: state.closesAt.toString(),
    phase: Number(state.phase), accepted: Number(state.accepted),
    publicKey: pointJson(state.publicKey), coefficientKey: pointJson(state.coefficientKey), trusteeKeys: pointsJson(state.trusteeKeys),
    aggregateA: pointsJson(state.aggregateA), aggregateB: pointsJson(state.aggregateB),
    ballots, decryptionShares, finalizedTotals: state.finalizedTotals.map(Number),
  };
}
