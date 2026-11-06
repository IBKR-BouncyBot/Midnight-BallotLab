/** TEST ONLY. A genuine SDK transaction fixture, with synthetic in-memory
 * witnesses. No wallet, indexer, balancing or submission provider is created.
 */
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/ledger-v8';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { createUnprovenDeployTxFromVerifierKeys, createUnprovenCallTxFromInitialStates } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract, ledger, pureCircuits } from '../managed/native-election/contract/index.js';
import { createDemoDealer, nativeWitnesses, randomSecret32 } from './adapter.mjs';

/** Return only a privacy-sensitive in-memory actual Ledger transaction. */
export async function createSyntheticConfigureTransaction(zkConfigProvider) {
  try {
    setNetworkId('undeployed'); // Fixture context only; never submitted.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const dealer = createDemoDealer(), administratorSecret = randomSecret32();
    const zeroKey = '0'.repeat(64); // Unfunded fixture identity; no coins involved.
    const compiledContract = CompiledContract.make('native-election', Contract).pipe(
      CompiledContract.withWitnesses(nativeWitnesses), CompiledContract.withCompiledFileAssets('./native-contract'));
    const deployment = await createUnprovenDeployTxFromVerifierKeys(zkConfigProvider, zeroKey, {
      compiledContract, initialPrivateState: {}, args: [randomSecret32(), randomSecret32(),
        pureCircuits.administratorIdentity(administratorSecret), now + 86400n, now + 172800n, 5n],
    }, zeroKey);
    const initialContractState = deployment.public.initialContractState;
    const before = ledger(initialContractState.data);
    if (before.keysConfigured || before.phase !== 0n) throw new Error('Unexpected fixture constructor');
    const call = await createUnprovenCallTxFromInitialStates(zkConfigProvider, {
      compiledContract, contractAddress: deployment.public.contractAddress, circuitId: 'configureKeys', args: [],
      coinPublicKey: zeroKey, initialContractState,
      initialPrivateState: { administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope },
      initialZswapChainState: new ZswapChainState(), ledgerParameters: LedgerParameters.initialParameters(),
    }, zeroKey);
    const after = ledger(call.public.nextContractState);
    if (!after.keysConfigured || after.phase !== 0n || after.accepted !== 0n) throw new Error('Unexpected fixture result');
    return call.private.unprovenTx;
  } catch {
    throw new Error('Synthetic SDK transaction construction failed; private diagnostics withheld');
  }
}

/** Exercise the production wrapper, observing real Ledger callback execution.
 * The observer delegates unchanged arguments/results; it supplies no proof.
 */
export async function proveSyntheticConfigureTransaction(provider, zkConfigProvider) {
  const transaction = await createSyntheticConfigureTransaction(zkConfigProvider);
  const callbacks = [];
  let proofBytes, proofSha256, checkElapsedMs, proveElapsedMs, bindingOverridePresent = false;
  const observe = async (delegate, operation, bytes, key, binding) => {
    if (key !== 'configureKeys') throw new Error('Unexpected diagnostic circuit');
    callbacks.push(operation);
    const start = performance.now();
    const result = operation === 'check' ? await delegate.check(bytes, key) : await delegate.prove(bytes, key, binding);
    const elapsed = Math.round(performance.now() - start);
    if (operation === 'check') checkElapsedMs = elapsed;
    else {
      if (!(result instanceof Uint8Array) || result.length === 0 || typeof binding !== 'bigint') {
        throw new Error('A real transaction-bound proof is required');
      }
      bindingOverridePresent = true; proveElapsedMs = elapsed; proofBytes = result.length;
      proofSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', result)),
        byte => byte.toString(16).padStart(2, '0')).join('');
    }
    return result;
  };
  const start = performance.now();
  // createProofProvider invokes .prove on this transparent observation surface;
  // the work is performed by the genuine Ledger transaction returned above.
  await provider.proveTx({ prove(delegate, costModel) {
    return transaction.prove({
      check: (bytes, key) => observe(delegate, 'check', bytes, key),
      prove: (bytes, key, binding) => observe(delegate, 'prove', bytes, key, binding),
    }, costModel);
  } });
  if (callbacks.length !== 2 || callbacks[0] !== 'check' || callbacks[1] !== 'prove' || !bindingOverridePresent) {
    throw new Error('Unexpected transaction proving sequence');
  }
  return Object.freeze({ circuit: 'configureKeys', construction: 'official-sdk-from-generated-state',
    provider: 'production-proveTx', callbackOrder: callbacks, bindingOverridePresent,
    proofBytes, proofSha256, checkElapsedMs, proveElapsedMs, elapsedMs: Math.round(performance.now() - start) });
}
