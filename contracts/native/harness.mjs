/** Actual generated-contract emulator harness, NOT a Midnight network client.
 * Requires compiled native-election output and the pinned runtime. No fallback.
 * Circuit proofData and private contexts are intentionally never exported.
 */
import { nativeWitnesses, requireBytes32, requireScalar, requireCandidateCount, pairCoefficients, pointEqual, NATIVE_CAPACITY, NATIVE_CANDIDATES } from './adapter.mjs';
import { projectNativePublicLedger } from './record.mjs';

export async function loadNativeModules() {
  try {
    const runtime = await import('@midnight-ntwrk/compact-runtime');
    const bindings = await import('../managed/native-election/contract/index.js');
    return { runtime, bindings };
  } catch (cause) {
    throw new Error('Native emulator unavailable: install the pinned contracts dependencies and compile native-election.compact. No substitute runtime is used.', { cause });
  }
}

function seconds(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Emulator time must be nonnegative integer Unix seconds');
  return value;
}

export async function createNativeEmulator({
  electionId, manifestDigest, administratorSecret, setupSecret, setupSlope,
  opensAt, closesAt, candidateCount, address, initialTime,
}) {
  requireCandidateCount(candidateCount);
  requireBytes32(electionId, 'electionId');
  requireBytes32(manifestDigest, 'manifestDigest');
  requireBytes32(administratorSecret, 'administratorSecret');
  requireScalar(setupSecret, 'setupSecret'); requireScalar(setupSlope, 'setupSlope');
  seconds(opensAt); seconds(closesAt);
  if (opensAt === 0 || opensAt >= closesAt) throw new RangeError('Require 0 < opensAt < closesAt');
  const { runtime: RT, bindings } = await loadNativeModules();
  const { Contract, ledger, pureCircuits } = bindings;
  const contract = new Contract(nativeWitnesses);
  const coinPublicKey = '0'.repeat(64); // Emulator placeholder, never a funded network wallet.
  const contractAddress = address ?? RT.sampleContractAddress();
  if (typeof contractAddress !== 'string' || !/^[0-9a-f]{64}$/.test(contractAddress)) throw new TypeError('Invalid emulator contract address');
  const constructorPrivateState = {};
  const initial = contract.initialState(
    RT.createConstructorContext(constructorPrivateState, coinPublicKey),
    electionId, manifestDigest, pureCircuits.administratorIdentity(administratorSecret),
    BigInt(opensAt), BigInt(closesAt), BigInt(candidateCount),
  );
  // Deployment does not prove constructor computations. Key setup is a separate
  // impure circuit and must be proven on the actual network.
  let context = RT.createCircuitContext(contractAddress, coinPublicKey,
    initial.currentContractState, { administratorSecret }, undefined, undefined, seconds(initialTime ?? opensAt - 1));

  const readLedger = () => ledger(context.currentQueryContext.state);
  const setPrivateState = privateState => {
    if (!privateState || Object.getPrototypeOf(privateState) !== Object.prototype) throw new TypeError('Native private state must be a plain object');
    // Replace rather than merge roles, to avoid carrying a previous voter's inputs.
    context = { ...context, currentPrivateState: privateState };
  };
  const setTime = time => {
    context = RT.createCircuitContext(contractAddress, coinPublicKey,
      context.currentQueryContext.state, context.currentPrivateState,
      undefined, undefined, seconds(time));
  };
  const call = (name, ...args) => {
    if (!Object.hasOwn(contract.impureCircuits, name) || typeof contract.impureCircuits[name] !== 'function') {
      throw new Error('Unknown native circuit');
    }
    const result = contract.impureCircuits[name](context, ...args);
    context = result.context;
    // result.proofData can contain private witnesses. Never return or serialize it.
    return result.result;
  };
  setPrivateState({ administratorSecret, setupSecret, setupSlope });
  call('configureKeys');
  setPrivateState({ administratorSecret });
  return Object.freeze({ contractAddress, pureCircuits, readLedger, setPrivateState, setTime, call });
}

/** Recover small public totals using ONLY generated native point helpers. */
export function recoverNativeTally(emulator, first, second) {
  const state = emulator.readLedger();
  if (state.phase !== 2n && state.phase !== 3n) throw new Error('Native voting must be closed before tally recovery');
  if (state.accepted < 0n || state.accepted > BigInt(NATIVE_CAPACITY)) throw new Error('Native ballot count exceeds capacity');
  const candidateCount = requireCandidateCount(typeof state.candidateCount === 'bigint' ? Number(state.candidateCount) : NaN);
  if (state.aggregateB.length !== NATIVE_CANDIDATES) throw new Error('Native aggregate must contain all five candidate lanes');
  const coefficients = pairCoefficients(first, second);
  if (!state.decryptionShares.member(first) || !state.decryptionShares.member(second)) throw new Error('The selected native trustee shares are not published');
  const d1 = state.decryptionShares.lookup(first);
  const d2 = state.decryptionShares.lookup(second);
  const { addPoints, negatePoint, scalePoint, nativePublicKey } = emulator.pureCircuits;
  return state.aggregateB.map((b, candidate) => {
    const combined = addPoints(scalePoint(d1[candidate], coefficients.first),
      negatePoint(scalePoint(d2[candidate], coefficients.second)));
    const target = addPoints(scalePoint(b, coefficients.scale), negatePoint(combined));
    for (let count = 0n; count <= state.accepted; count++) {
      if (pointEqual(target, nativePublicKey(coefficients.scale * count))) {
        if (candidate >= candidateCount && count !== 0n) throw new Error('Inactive native candidate has a nonzero total');
        return count;
      }
    }
    throw new Error('No bounded total matches the native aggregate and trustee shares');
  });
}

/** Check native receipt hashes with generated code, then project public fields. */
export function nativePublicSnapshot(emulator) {
  const state = emulator.readLedger();
  if (state.accepted < 0n || state.accepted > BigInt(NATIVE_CAPACITY)) throw new Error('Native ballot count exceeds capacity');
  for (let index = 0n; index < state.accepted; index++) {
    const expected = emulator.pureCircuits.receiptDigest(state.electionId, state.configurationDigest,
      state.nullifiers.lookup(index), state.ballotA.lookup(index), state.ballotB.lookup(index));
    const receipt = state.ballotReceipts.lookup(index);
    if (receipt.length !== expected.length || receipt.some((byte, i) => byte !== expected[i]) || !state.receipts.member(receipt)) {
      throw new Error('Native receipt ledger is inconsistent');
    }
  }
  return projectNativePublicLedger(state, { contractAddress: emulator.contractAddress });
}
