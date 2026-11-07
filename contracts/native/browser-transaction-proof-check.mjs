/** TEST ONLY. A genuine SDK transaction fixture, with synthetic in-memory
 * witnesses. No wallet, indexer, balancing or submission provider is created.
 */
import { LedgerParameters, ZswapChainState } from '@midnightntwrk/ledger-v9';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { SerializedLedgerParameters, SerializedZswapChainState } from '@midnight-ntwrk/midnight-js-types';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { createUnprovenDeployTxFromVerifierKeys, createUnprovenCallTxFromInitialStates } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract, ledger, pureCircuits } from '../managed/native-election/contract/index.js';
import { createDemoDealer, nativeWitnesses, randomSecret32 } from './adapter.mjs';

/** Return only a privacy-sensitive in-memory actual Ledger transaction. */
export async function createSyntheticConfigureTransaction(zkConfigProvider) {
  try {
    const config = { networkId: 'undeployed', ttlSeconds: 3600 }; // Never submitted.
    const now = BigInt(Math.floor(Date.now() / 1000));
    const dealer = createDemoDealer(), administratorSecret = randomSecret32();
    const zeroKey = '0'.repeat(64); // Unfunded fixture identity; no coins involved.
    const compiledContract = CompiledContract.make('native-election', Contract).pipe(
      CompiledContract.withWitnesses(nativeWitnesses), CompiledContract.withCompiledFileAssets('./native-contract'));
    const deployment = await createUnprovenDeployTxFromVerifierKeys(zkConfigProvider, zeroKey, {
      compiledContract, initialPrivateState: {}, args: [randomSecret32(), randomSecret32(),
        pureCircuits.administratorIdentity(administratorSecret), now + 86400n, now + 172800n, 5n],
    }, zeroKey, config);
    const initialContractState = deployment.public.initialContractState;
    const before = ledger(initialContractState.deserialize({ v9: ContractState }).data);
    if (before.keysConfigured || before.phase !== 0n) throw new Error('Unexpected fixture constructor');
    const call = await createUnprovenCallTxFromInitialStates(zkConfigProvider, {
      compiledContract, contractAddress: deployment.public.contractAddress, circuitId: 'configureKeys', args: [],
      coinPublicKey: zeroKey, initialContractState,
      initialPrivateState: { administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope },
      initialZswapChainState: SerializedZswapChainState.fromBytes('v9', new ZswapChainState().serialize()),
      ledgerParameters: SerializedLedgerParameters.fromBytes('v9', LedgerParameters.initialParameters().serialize()), config,
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
export async function proveSyntheticConfigureTransaction(provider, zkConfigProvider, proofResults) {
  const transaction = await createSyntheticConfigureTransaction(zkConfigProvider);
  const before = proofResults.length;
  const start = performance.now();
  const proven = await provider.proveTx(transaction);
  const observed = proofResults.slice(before);
  if (proven.era !== 'v9' || proven.stage !== 'Unbound' || observed.length !== 2
      || observed[0].operation !== 'check' || observed[1].operation !== 'prove'
      || observed.some(item => item.circuit !== 'configureKeys') || !observed[1].bindingOverridePresent) {
    throw new Error('Unexpected transaction proving sequence');
  }
  return Object.freeze({ circuit: 'configureKeys', construction: 'official-sdk-from-generated-state',
    provider: 'production-proveTx', callbackOrder: observed.map(item => item.operation), bindingOverridePresent: true,
    proofBytes: observed[1].proofBytes, proofSha256: observed[1].proofSha256,
    checkElapsedMs: observed[0].elapsedMs, proveElapsedMs: observed[1].elapsedMs, elapsedMs: Math.round(performance.now() - start) });
}
