/** Provider-injected Midnight.js 5 client for the ledger-9 contract.
 * Requires real generated bindings, runtime, SDK providers, prover and wallet.
 * The network browser entry imports this client. No network activity occurs on import.
 * Native compilation is separate from proving and accepted network transactions.
 */
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import * as Native from '../managed/native-election/contract/index.js';
import { nativeWitnesses, requireBytes32, requireScalar, requireCandidateCount, freshBallotRandomness, pairCoefficients, NATIVE_CAPACITY, NATIVE_CANDIDATES } from './adapter.mjs';
import { recoverNativeTally } from './harness.mjs';
import { requireDevelopmentNetwork } from './browser-config.mjs';

const PRIVATE_STATE_ID = 'ballotNativeTransientWitnessStateV1';
const sameBytes = (left, right) => left instanceof Uint8Array && right instanceof Uint8Array
  && left.length === right.length && left.every((byte, index) => byte === right[index]);
const addressValue = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new TypeError('Expected a native contract address');
  return value;
};
const publicTransaction = tx => ({
  txId: tx.public.txId, blockHeight: String(tx.public.blockHeight),
  confirmationSource: 'configured-indexer', ledgerInclusionIndependentlyVerified: false,
});
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const RECEIPT_SCHEMA = 'midnight-ballot-lab/native-receipt/v1';

const acceptedCount = state => {
  if (typeof state.accepted !== 'bigint' || state.accepted < 0n || state.accepted > BigInt(NATIVE_CAPACITY)) throw new Error('Indexed native ballot count exceeds capacity');
  return state.accepted;
};

function checkIndexedReceiptAt(state, index, receiptId) {
  if (index < 0n || index >= acceptedCount(state)) throw new Error('Native receipt is not in the indexed accepted set');
  const stored = state.ballotReceipts.lookup(index);
  const expected = Native.pureCircuits.receiptDigest(state.electionId, state.configurationDigest,
    state.nullifiers.lookup(index), state.ballotA.lookup(index), state.ballotB.lookup(index));
  if (!sameBytes(stored, expected) || hex(stored) !== receiptId || !state.receipts.member(stored)) throw new Error('Indexed native receipt does not match');
}

/** Public-record consistency only. The SDK method additionally pins the current
 * session/election configuration. This does not authenticate supplied state or
 * establish that a person owns the receipt. Uses the real generated digest.
 */
export function findReceiptIdInIndexedNativeLedger(state, value) {
  if (typeof value !== 'string') throw new TypeError('Expected a 64-character hexadecimal receipt ID');
  const receiptId = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(receiptId)) throw new TypeError('Expected a 64-character hexadecimal receipt ID');
  const count = acceptedCount(state);
  let found = null;
  for (let index = 0n; index < count; index++) {
    if (hex(state.ballotReceipts.lookup(index)) !== receiptId) continue;
    if (found !== null) throw new Error('Receipt ID is not unique in the indexed accepted set');
    found = index;
  }
  if (found === null) throw new Error('Receipt ID was not found in the indexed accepted set');
  checkIndexedReceiptAt(state, found, receiptId);
  return Object.freeze({ index: Number(found), receipt: receiptId });
}

/** Supply official providers yourself. This adapter never invents mock providers. */
export function createNativeSdkClient(providers, { compiledAssetsPath, networkId, assertSession = async () => {} }) {
  if (typeof compiledAssetsPath !== 'string' || !compiledAssetsPath) throw new TypeError('compiledAssetsPath is required');
  requireDevelopmentNetwork(networkId);
  if (typeof assertSession !== 'function') throw new TypeError('assertSession must be a function');
  const requireNetwork = () => {
    if (providers?.config?.networkId !== networkId) throw new Error('Midnight.js network changed; reconnect before operating this client');
  };
  requireNetwork();
  for (const name of ['privateStateProvider', 'publicDataProvider', 'zkConfigProvider', 'proofProvider', 'walletProvider', 'midnightProvider']) {
    if (!providers?.[name]) throw new TypeError(`Missing Midnight provider: ${name}`);
  }
  let activeInputs = null;
  let busy = false;
  let handle = null;
  let contractAddress = null;
  let expectedConfiguration = null;
  let pendingBallot = null;
  const scopedWitnesses = Object.fromEntries(Object.entries(nativeWitnesses).map(([name, read]) => [name, context => {
    if (!activeInputs) throw new Error('No active native witness input scope');
    const [, value] = read({ ...context, privateState: activeInputs });
    // The SDK's stored private state never receives vote choices or randomness.
    // The on-device proving worker receives these witnesses in memory.
    return [context.privateState, value];
  }]));
  const compiled = CompiledContract.make('native-election', Native.Contract).pipe(
    CompiledContract.withWitnesses(scopedWitnesses),
    CompiledContract.withCompiledFileAssets(compiledAssetsPath),
  );
  async function exclusive(operation) {
    if (busy) throw new Error('A native operation is already in progress');
    busy = true;
    try { requireNetwork(); await assertSession(); return await operation(); }
    finally { activeInputs = null; busy = false; }
  }
  async function readLedger() {
    if (!contractAddress) throw new Error('Deploy or join a native contract first');
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    if (state === null) throw new Error('The indexer did not return the native contract state');
    if (state.contractState?.era !== 'v9') throw new Error('This build requires a ledger-9 election');
    return Native.ledger(state.contractState.deserialize({ v9: ContractState }).data);
  }
  async function requireConfiguration() {
    if (!handle || !expectedConfiguration) throw new Error('The native contract configuration has not been pinned');
    const state = await readLedger();
    if (!state.keysConfigured || !sameBytes(state.configurationDigest, expectedConfiguration)) throw new Error('Native configuration does not match the expected digest');
    requireCandidateCount(typeof state.candidateCount === 'bigint' ? Number(state.candidateCount) : NaN);
    const recomputed = Native.pureCircuits.configurationDigestFor(state.electionId, state.manifestDigest,
      state.administrator, state.opensAt, state.closesAt, state.candidateCount, state.publicKey, state.coefficientKey, state.trusteeKeys);
    if (!sameBytes(recomputed, expectedConfiguration)) throw new Error('Native configuration fields are inconsistent');
    return state;
  }
  async function invoke(name, args, inputs = {}) {
    if (!handle) throw new Error('Deploy or join a native contract first');
    requireNetwork();
    await assertSession();
    activeInputs = inputs;
    const tx = await handle.callTx[name](...args);
    return publicTransaction(tx);
  }
  async function findPendingReceipt() {
    if (!pendingBallot) throw new Error('No pending ballot in this client session');
    const finalState = await requireConfiguration();
    if (typeof finalState.accepted !== 'bigint' || finalState.accepted < 0n || finalState.accepted > BigInt(NATIVE_CAPACITY)) throw new Error('Indexed native ballot count exceeds capacity');
    for (let index = 0n; index < finalState.accepted; index++) {
      if (hex(finalState.nullifiers.lookup(index)) !== pendingBallot.nullifier) continue;
      const receipt = finalState.ballotReceipts.lookup(index);
      const expected = Native.pureCircuits.receiptDigest(finalState.electionId, finalState.configurationDigest,
        finalState.nullifiers.lookup(index), finalState.ballotA.lookup(index), finalState.ballotB.lookup(index));
      if (!sameBytes(receipt, expected) || !finalState.receipts.member(receipt)) throw new Error('Indexed native receipt is inconsistent');
      if (hex(receipt) !== pendingBallot.receipt) throw new Error('Indexed native receipt does not match the locally constructed ballot');
      const result = { ...pendingBallot.transaction, schema: RECEIPT_SCHEMA, networkId, contractAddress,
        index: Number(index), receipt: hex(receipt), configurationDigest: hex(expectedConfiguration),
        confirmationSource: 'configured-indexer', ledgerInclusionIndependentlyVerified: false,
        transactionReferenceVerified: false };
      pendingBallot = null;
      return result;
    }
    throw new Error('Pending ballot was not found in the indexed accepted set; do not automatically resubmit');
  }

  return Object.freeze({
    // The caller must configure every provider for this network. This value is
    // a receipt context label; it does not authenticate an indexer endpoint.
    networkId,
    get contractAddress() { return contractAddress; },
    get configurationDigest() { return expectedConfiguration?.slice() ?? null; },
    readPublicLedger: () => exclusive(readLedger),
    // Retry the public read after a configuration transaction confirmed but its
    // follow-up indexer query failed. This does not submit a second transaction.
    refreshConfiguration: () => exclusive(requireConfiguration),
    // Contains only public commitments, never inputs or proof data. A pending
    // record can remain after wallet rejection too; absence is not confirmation.
    get pendingBallotReceipt() { return pendingBallot ? { ...pendingBallot, transaction: { ...pendingBallot.transaction } } : null; },
    recoverPendingReceipt: () => exclusive(findPendingReceipt),
    async deploy({ electionId, manifestDigest, administratorIdentity, opensAt, closesAt, candidateCount }) {
      return exclusive(async () => {
        if (handle) throw new Error('This client already has a native contract');
        requireCandidateCount(candidateCount);
        for (const [name, value] of Object.entries({ electionId, manifestDigest, administratorIdentity })) requireBytes32(value, name);
        if (typeof opensAt !== 'bigint' || typeof closesAt !== 'bigint' || opensAt < 0n || opensAt >= closesAt || closesAt >= 2n ** 64n) throw new TypeError('Invalid native voting window');
        const deployed = await deployContract(providers, {
          compiledContract: compiled, privateStateId: PRIVATE_STATE_ID, initialPrivateState: {},
          args: [electionId, manifestDigest, administratorIdentity, opensAt, closesAt, BigInt(candidateCount)],
        });
        handle = deployed;
        contractAddress = addressValue(deployed.deployTxData.public.contractAddress);
        // Deployment itself does not prove key setup. configureKeys is separate.
        return { ...publicTransaction(deployed.deployTxData), networkId, contractAddress, keysConfigured: false };
      });
    },
    async configureKeys({ administratorSecret, setupSecret, setupSlope }) {
      return exclusive(async () => {
        requireBytes32(administratorSecret, 'administratorSecret');
        requireScalar(setupSecret, 'setupSecret'); requireScalar(setupSlope, 'setupSlope');
        const state = await readLedger();
        if (state.keysConfigured) throw new Error('Native trustee keys are already configured');
        const pure = Native.pureCircuits;
        const key = pure.nativePublicKey(setupSecret), coefficient = pure.nativePublicKey(setupSlope);
        const k1 = pure.addPoints(key, coefficient), k2 = pure.addPoints(k1, coefficient), k3 = pure.addPoints(k2, coefficient);
        const expected = pure.configurationDigestFor(state.electionId, state.manifestDigest, state.administrator,
          state.opensAt, state.closesAt, state.candidateCount, key, coefficient, [k1, k2, k3]);
        const tx = await invoke('configureKeys', [], { administratorSecret, setupSecret, setupSlope });
        expectedConfiguration = expected;
        await requireConfiguration();
        return { ...tx, configurationDigest: expected.slice() };
      });
    },
    async join(address, expectedDigest) {
      return exclusive(async () => {
        if (handle) throw new Error('This client already has a native contract');
        addressValue(address); requireBytes32(expectedDigest, 'expectedConfigurationDigest');
        providers.privateStateProvider.setContractAddress(address);
        const stored = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
        try {
          handle = await findDeployedContract(providers, {
            contractAddress: address, compiledContract: compiled, privateStateId: PRIVATE_STATE_ID,
            ...(stored === null ? { initialPrivateState: {} } : {}),
          });
          contractAddress = address;
          expectedConfiguration = expectedDigest.slice();
          await requireConfiguration();
          return { contractAddress, configurationDigest: expectedConfiguration.slice() };
        } catch (error) {
          // A bad digest or failed indexer read must not leave a half-joined
          // client that rejects every subsequent join as already connected.
          handle = null; contractAddress = null; expectedConfiguration = null;
          throw error;
        }
      });
    },
    async enroll(member, administratorSecret) {
      return exclusive(async () => {
        requireBytes32(member, 'member'); requireBytes32(administratorSecret, 'administratorSecret');
        await requireConfiguration();
        return invoke('enroll', [member], { administratorSecret });
      });
    },
    async openVoting() {
      return exclusive(async () => { await requireConfiguration(); return invoke('openVoting', []); });
    },
    async castBallot({ voterSecret, selection }) {
      return exclusive(async () => {
        if (pendingBallot) throw new Error('Resolve this session\'s pending ballot before another cast; its submission outcome may be uncertain');
        const secret = requireBytes32(voterSecret, 'voterSecret').slice();
        nativeWitnesses.selection({ privateState: { selection } });
        const state = await requireConfiguration();
        if (selection >= state.candidateCount) throw new RangeError('Selection is outside this native election candidate count');
        const pure = Native.pureCircuits;
        const member = pure.memberIdentity(state.electionId, secret);
        const eligibilityPath = state.members.findPathForLeaf(member);
        const inputs = { voterSecret: secret, selection, eligibilityPath, ballotRandomness: freshBallotRandomness() };
        nativeWitnesses.eligibilityPath({ privateState: inputs });
        // Bind the returned receipt to the exact private inputs submitted below,
        // independently of whatever ciphertext the indexer later returns. These
        // calculations use generated Compact helpers, not a second curve library.
        const nullifier = pure.voterNullifier(state.electionId, secret);
        const expectedA = inputs.ballotRandomness.map(randomness => pure.nativePublicKey(randomness));
        const expectedB = inputs.ballotRandomness.map((randomness, candidate) => pure.addPoints(
          pure.scalePoint(state.publicKey, randomness), pure.nativePublicKey(selection === BigInt(candidate) ? 1n : 0n),
        ));
        const expectedReceipt = pure.receiptDigest(state.electionId, state.configurationDigest, nullifier, expectedA, expectedB);
        pendingBallot = { networkId, contractAddress, configurationDigest: hex(expectedConfiguration),
          nullifier: hex(nullifier), receipt: hex(expectedReceipt), transaction: {} };
        pendingBallot.transaction = await invoke('castBallot', [], inputs);
        // Read the indexed stored receipt after the SDK-confirmed call. The
        // receipt is tied to the native configuration and ciphertext record.
        return findPendingReceipt();
      });
    },
    async checkReceipt(receipt) {
      return exclusive(async () => {
        if (!receipt || receipt.schema !== RECEIPT_SCHEMA || receipt.networkId !== networkId || receipt.contractAddress !== contractAddress
          || !Number.isSafeInteger(receipt.index) || receipt.index < 0 || receipt.index >= NATIVE_CAPACITY
          || typeof receipt.receipt !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.receipt)) throw new TypeError('Receipt does not match this native client context');
        const state = await requireConfiguration();
        if (receipt.configurationDigest !== hex(expectedConfiguration)) throw new Error('Receipt configuration does not match the pinned election');
        checkIndexedReceiptAt(state, BigInt(receipt.index), receipt.receipt);
        return { receiptMatchesIndexedState: true, ledgerInclusionIndependentlyVerified: false,
          transactionReferenceVerified: false, networkId, contractAddress };
      });
    },
    async checkReceiptId(receiptId) {
      return exclusive(async () => {
        const state = await requireConfiguration();
        const found = findReceiptIdInIndexedNativeLedger(state, receiptId);
        return { ...found, receiptMatchesIndexedState: true, lookupOnly: true,
          fullReceiptContextValidated: false, receiptOwnershipVerified: false,
          ledgerInclusionIndependentlyVerified: false, transactionReferenceVerified: false,
          networkId, contractAddress, configurationDigest: hex(expectedConfiguration),
          confirmationSource: 'configured-indexer' };
      });
    },
    async recoverTally(first, second) {
      return exclusive(async () => {
        const state = await requireConfiguration();
        return recoverNativeTally({ readLedger: () => state, pureCircuits: Native.pureCircuits }, first, second);
      });
    },
    async closeVoting() {
      return exclusive(async () => { await requireConfiguration(); return invoke('closeVoting', []); });
    },
    async submitDecryption(index, trusteeSecretShare) {
      return exclusive(async () => {
        if (typeof index !== 'bigint' || index < 1n || index > 3n) throw new TypeError('Native trustee index must be 1n, 2n or 3n');
        requireScalar(trusteeSecretShare, 'trusteeSecretShare');
        await requireConfiguration();
        return invoke('submitDecryption', [index], { trusteeSecretShare });
      });
    },
    async finalize(first, second, totals) {
      return exclusive(async () => {
        pairCoefficients(first, second);
        if (!Array.isArray(totals) || totals.length !== NATIVE_CANDIDATES || totals.some(value => typeof value !== 'bigint' || value < 0n || value > BigInt(NATIVE_CAPACITY))) throw new TypeError('Expected five bounded native totals');
        await requireConfiguration();
        return invoke('finalize', [first, second, totals]);
      });
    },
  });
}
