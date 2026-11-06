/** Actual generated SDK transaction and Ledger rejection wrapping. The worker
 * is a fail-only transport double: it never checks/proves or returns proof bytes.
 * This is a diagnostic boundary test, not worker/proof/network acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { createUnprovenDeployTxFromVerifierKeys, createUnprovenCallTxFromInitialStates } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { LedgerParameters, ZswapChainState } from '@midnight-ntwrk/ledger-v8';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract, pureCircuits } from '../managed/native-election/contract/index.js';
import { createDemoDealer, nativeWitnesses, randomSecret32 } from '../native/adapter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
async function genuineTransaction() {
  setNetworkId('undeployed');
  const dealer = createDemoDealer(), administratorSecret = randomSecret32();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const compiledContract = CompiledContract.make('native-election', Contract).pipe(
    CompiledContract.withWitnesses(nativeWitnesses), CompiledContract.withCompiledFileAssets('./unused-test-assets'));
  const zk = new NodeZkConfigProvider(join(root, 'contracts/managed/native-election'));
  const zeroKey = '0'.repeat(64);
  const deployment = await createUnprovenDeployTxFromVerifierKeys(zk, zeroKey, {
    compiledContract, initialPrivateState: {}, args: [randomSecret32(), randomSecret32(),
      pureCircuits.administratorIdentity(administratorSecret), now + 86400n, now + 172800n, 3n],
  }, zeroKey);
  const result = await createUnprovenCallTxFromInitialStates(zk, {
    compiledContract, circuitId: 'configureKeys', args: [], coinPublicKey: zeroKey,
    contractAddress: deployment.public.contractAddress, initialContractState: deployment.public.initialContractState,
    initialPrivateState: { administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope },
    initialZswapChainState: new ZswapChainState(), ledgerParameters: LedgerParameters.initialParameters(),
  }, zeroKey);
  return result.private.unprovenTx;
}

test('worker terminal diagnostics survive actual Ledger callback-error wrapping', { timeout: 30_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ballot-prover-failure-'));
  const originalWorker = globalThis.Worker, originalTimeout = globalThis.setTimeout;
  let provider;
  try {
    // Keep the same installed native modules as this test; only relocate the
    // provider's browser import URL for its same-origin worker URL validation.
    const built = await esbuild.build({ absWorkingDir: root, entryPoints: [join(root, 'contracts/native/browser-wasm-proof.mjs')],
      bundle: true, platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
      define: { 'import.meta.url': JSON.stringify('https://fixture.invalid/network-bundle.mjs') },
      plugins: [{ name: 'same-installed-sdk', setup(build) {
        build.onResolve({ filter: /^@midnight-ntwrk\// }, args => ({
          path: pathToFileURL(require.resolve(args.path).replace(/\.cjs$/, '.mjs')).href, external: true,
        }));
      } }],
    });
    await writeFile(join(folder, 'provider.mjs'), built.outputFiles[0].contents);
    const { createNativeWasmProofProvider, nativeWasmProofErrorCode, nativeWasmProofErrorMessage }
      = await import(pathToFileURL(join(folder, 'provider.mjs')).href);
    let transaction;
    try { transaction = await genuineTransaction(); }
    catch { throw new Error('Actual synthetic SDK transaction construction failed'); }
    for (const code of ['PROOF_TIMEOUT', 'ASSET_INTEGRITY', 'CANCELLED']) {
      let terminated = false, callbacks = 0, wrappedError;
      globalThis.Worker = class FailingWorkerSurface {
        listeners = new Set();
        constructor() { queueMicrotask(() => this.emit({ type: 'booted' })); }
        addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); }
        emit(data) { for (const listener of this.listeners) listener({ data }); }
        postMessage(data) {
          if (data.type === 'initialize') { queueMicrotask(() => this.emit({ type: 'ready' })); return; }
          callbacks++;
          assert.equal(data.type, 'execute'); assert.equal(data.operation, 'check');
          // No preimage is inspected, copied, logged or passed to cryptography.
          if (code === 'ASSET_INTEGRITY') queueMicrotask(() => this.emit({ type: 'failure', code }));
          else if (code === 'CANCELLED') queueMicrotask(() => provider.close());
        }
        terminate() { terminated = true; }
      };
      globalThis.setTimeout = (callback, delay, ...args) => originalTimeout(callback,
        code === 'PROOF_TIMEOUT' && delay === 15 * 60 * 1000 ? 0 : delay, ...args);
      provider = await createNativeWasmProofProvider({ compiledAssetsUrl: 'https://fixture.invalid/native-contract' });
      await assert.rejects(provider.proveTx({ async prove(...args) {
        try { return await transaction.prove(...args); }
        catch (error) { wrappedError = error; throw error; }
      } }), error => nativeWasmProofErrorCode(error) === code
        && typeof nativeWasmProofErrorMessage(error) === 'string');
      assert.ok(wrappedError instanceof Error, 'The actual Ledger must reject its callback failure');
      assert.equal(nativeWasmProofErrorCode(wrappedError), null, 'Ledger creates a new, unbranded Error');
      assert.equal(callbacks, 1, 'Failure must stop before any proof callback');
      assert.equal(terminated, true);
      provider.close(); provider = undefined;
    }
  } finally {
    provider?.close(); globalThis.Worker = originalWorker; globalThis.setTimeout = originalTimeout;
    assert.ok(dirname(folder) === resolve(tmpdir()) && basename(folder).startsWith('ballot-prover-failure-'),
      'Cleanup must stay inside the task-created temporary directory');
    await rm(folder, { recursive: true, force: true });
  }
});
