/** Real worker thread + official WASM, testing startup transport only.
 * The small EventTarget bridge adapts Node's parentPort; it replaces no
 * cryptography. No proof, wallet or network transaction is claimed here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as Thread } from 'node:worker_threads';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';
import { nativeWasmPlugin } from '../../scripts/native-wasm-plugin.mjs';
import { NATIVE_PROVER_CIRCUITS, NATIVE_PROVER_PARAMETERS, NATIVE_PROVER_PARAMETER_BYTES,
  NATIVE_PROVER_ASSET_SCHEMA } from '../native/wasm-prover-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('production provider waits for the actual WASM worker listener before initializing', { timeout: 30_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ballot-worker-startup-'));
  const assets = new Map();
  const fixtureAsset = path => ({ path, bytes: 1, sha256: 'a'.repeat(64) });
  // Only the manifest boundary is exercised; no fixture key is fetched or used.
  const manifest = Buffer.from(JSON.stringify({ schema: NATIVE_PROVER_ASSET_SCHEMA, proverVersion: '2.1.1',
    circuits: Object.entries(NATIVE_PROVER_CIRCUITS).map(([name, k]) => ({ name, k,
      prover: fixtureAsset(`keys/${name}.prover`), verifier: fixtureAsset(`keys/${name}.verifier`), ir: fixtureAsset(`zkir/${name}.bzkir`) })),
    params: Object.entries(NATIVE_PROVER_PARAMETERS).map(([k, sha256]) => ({ k: Number(k),
      path: `params/bls_midnight_2p${k}`, bytes: NATIVE_PROVER_PARAMETER_BYTES[k], sha256 })),
  }));
  let delayedWasmResponse = false, wasmResponseCompleted = false, initializeBeforeBoot = false, initializationRequests = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const path = request.url.slice(1);
    if (path === 'native-contract/prover-manifest.json') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(manifest); return;
    }
    const bytes = assets.get(path);
    if (!bytes) { response.writeHead(404).end(); return; }
    if (path.includes('midnight_zkir_wasm')) {
      delayedWasmResponse = true;
      await new Promise(resolve => setTimeout(resolve, 150));
      wasmResponseCompleted = true;
    }
    response.writeHead(200, { 'Content-Type': 'application/wasm', 'Content-Length': bytes.length }).end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const common = { absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    nodePaths: [join(root, 'contracts/node_modules')], conditions: ['browser', 'import'], mainFields: ['browser', 'module', 'main'],
    write: false, sourcemap: false, logLevel: 'silent' };
  let realWorker, provider, workerStopped;
  const originalWorker = globalThis.Worker;
  try {
    const workerBuild = await esbuild.build({ ...common,
      entryPoints: [join(root, 'contracts/native/wasm-prover-worker.mjs')], outfile: join(folder, 'worker.mjs'),
      define: { 'import.meta.url': JSON.stringify(`${base}/native-prover-worker.mjs`),
        __NATIVE_PROVER_MANIFEST_SHA256__: JSON.stringify(digest(manifest)) },
      plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'worker-assets', verifyIntegrity: true })],
    });
    await writeFile(join(folder, 'worker.mjs'), workerBuild.outputFiles[0].contents);
    const parentBuild = await esbuild.build({ ...common,
      stdin: { contents: 'export * from "./native/browser-wasm-proof.mjs"; export { CostModel as StartupCostModel } from "@midnight-ntwrk/ledger-v8";',
        sourcefile: 'worker-startup-test-entry.mjs', resolveDir: join(root, 'contracts') }, outfile: join(folder, 'parent.mjs'),
      define: { 'import.meta.url': JSON.stringify(`${base}/network-bundle.mjs`) },
      inject: [join(root, 'scripts/network-browser-globals.mjs')], metafile: true,
      plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'parent-assets', browserPackages: {
        buffer: require.resolve('buffer/'), events: require.resolve('events/'), assert: require.resolve('assert/'),
        'process/browser.js': require.resolve('process/browser.js'),
      } })],
    });
    assert.deepEqual(Object.keys(parentBuild.metafile.inputs).map(path => path.replaceAll('\\', '/'))
      .filter(path => path.endsWith('node_modules/process/browser.js')), ['contracts/node_modules/process/browser.js']);
    await writeFile(join(folder, 'parent.mjs'), parentBuild.outputFiles[0].contents);
    await writeFile(join(folder, 'thread.mjs'), `import { parentPort, workerData } from 'node:worker_threads';
const listeners = new Set();
globalThis.location = { href: workerData.url };
globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
globalThis.addEventListener = (type, listener) => { if (type === 'message') listeners.add(listener); };
parentPort.on('message', data => { for (const listener of listeners) listener({ data }); });
await import(workerData.module);
`);
    const events = [];
    globalThis.Worker = class RealWorkerSurface {
      constructor(url) {
        assert.equal(url.href, `${base}/native-prover-worker.mjs`);
        this.booted = false;
        realWorker = new Thread(pathToFileURL(join(folder, 'thread.mjs')), { workerData: {
          url: url.href, module: pathToFileURL(join(folder, 'worker.mjs')).href,
        } });
        workerStopped = new Promise(resolve => realWorker.once('exit', resolve));
        realWorker.on('message', data => { if (data?.type === 'booted') { this.booted = true; events.push('booted'); } });
      }
      addEventListener(type, listener) {
        if (type === 'message') realWorker.on('message', data => listener({ data }));
        else if (type === 'error') realWorker.on('error', () => listener({ preventDefault() {} }));
        else if (type === 'messageerror') realWorker.on('messageerror', () => listener({}));
      }
      postMessage(data, transfer) {
        if (data.type === 'initialize') {
          initializationRequests++; events.push('initialize');
          if (!this.booted || !wasmResponseCompleted) initializeBeforeBoot = true;
        }
        realWorker.postMessage(data, transfer);
      }
      terminate() { void realWorker.terminate(); }
    };
    const { createNativeWasmProofProvider, StartupCostModel, nativeWasmProofErrorCode, nativeWasmProofErrorMessage }
      = await import(pathToFileURL(join(folder, 'parent.mjs')).href);
    provider = await createNativeWasmProofProvider({ compiledAssetsUrl: `${base}/native-contract`,
      onStage: stage => { if (stage === 'browser-prover-ready') events.push('ready'); },
    });
    assert.equal(delayedWasmResponse, true);
    assert.equal(initializeBeforeBoot, false, 'Initialization must wait until real WASM and the listener are ready');
    assert.equal(initializationRequests, 1);
    assert.deepEqual(events, ['booted', 'initialize', 'ready']);
    provider.close(); provider = undefined;
    await workerStopped;
    // Deliberately fail this boundary after genuine worker startup. This does
    // not return invented crypto or a simulated successful wallet/proof.
    const actualInitialCostModel = StartupCostModel.initialCostModel;
    StartupCostModel.initialCostModel = () => { throw new Error('SYNTHETIC-PRIVATE-INITIALIZER-ERROR'); };
    let reachedReady = false;
    try {
      await assert.rejects(createNativeWasmProofProvider({ compiledAssetsUrl: `${base}/native-contract`,
        onStage: stage => { if (stage === 'browser-prover-ready') reachedReady = true; },
      }), error => nativeWasmProofErrorCode(error) === 'WORKER_UNAVAILABLE'
        && !nativeWasmProofErrorMessage(error).includes('SYNTHETIC'));
      assert.equal(reachedReady, true);
      await workerStopped;
      assert.equal(realWorker.threadId, -1, 'A failed post-ready initializer must terminate its real worker');
    } finally { StartupCostModel.initialCostModel = actualInitialCostModel; }
  } finally {
    provider?.close();
    await realWorker?.terminate();
    globalThis.Worker = originalWorker;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
