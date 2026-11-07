/** Real browser-format SDK/runtime modules in Node; no wallet/proof/network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { nativeWasmPlugin } from '../../scripts/native-wasm-plugin.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
test('split browser SDK bundle initializes real modules and constructs a sealed v9 transaction', { timeout: 30_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ballot-sdk-initialization-'));
  const assets = new Map(), originalFetch = globalThis.fetch;
  try {
    const built = await esbuild.build({ absWorkingDir: root, stdin: {
      contents: 'export { createSyntheticConfigureTransaction } from "./contracts/native/browser-transaction-proof-check.mjs"; export { createNativeSdkClient } from "./contracts/native/sdk-client.mjs";',
      resolveDir: root, sourcefile: 'sdk-init.mjs' },
      outdir: folder, entryNames: 'sdk', splitting: true, chunkNames: 'network-chunk-[hash]', outExtension: { '.js': '.mjs' },
      bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, metafile: true, logLevel: 'silent',
      nodePaths: [join(root, 'contracts/node_modules')], conditions: ['browser', 'import'], mainFields: ['browser', 'module', 'main'],
      inject: [join(root, 'scripts/network-browser-globals.mjs')],
      plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'runtime-assets', browserPackages: {
        buffer: require.resolve('buffer/'), events: require.resolve('events/'), assert: require.resolve('assert/'),
        'process/browser.js': require.resolve('process/browser.js'),
      } })],
    });
    assert.equal(built.warnings.length, 0);
    assert.ok(built.outputFiles.length > 1);
    assert.equal(Object.values(built.metafile.outputs).flatMap(value => value.imports).some(value => value.external), false);
    assert.equal(assets.size, 4, 'All official v9 and SDK v8 compatibility WASMs remain real');
    for (const output of built.outputFiles) {
      assert.equal(dirname(output.path), folder);
      assert.match(basename(output.path), /^(?:sdk|network-chunk-[A-Z0-9]{8})\.mjs$/);
      await writeFile(output.path, output.contents);
    }
    const loaded = new Set();
    globalThis.fetch = async value => {
      const path = new URL(value).pathname.split('/runtime-assets/')[1];
      const bytes = assets.get(`runtime-assets/${path}`);
      assert.ok(bytes, 'Only actual bundled public WASM may be requested');
      loaded.add(path); return new Response(bytes, { headers: { 'content-type': 'application/wasm' } });
    };
    const bundled = await import(pathToFileURL(join(folder, 'sdk.mjs')).href);
    assert.equal(typeof bundled.createNativeSdkClient, 'function');
    const transaction = await bundled.createSyntheticConfigureTransaction(new NodeZkConfigProvider(join(root, 'contracts/managed/native-election')));
    assert.equal(transaction.era, 'v9'); assert.equal(transaction.stage, 'Unproven');
    assert.equal(loaded.size, 2, 'Only the actual v9 ledger/runtime initialize; v8 compatibility stays lazy');
    assert.ok([...loaded].some(path => path.startsWith('midnight_ledger_wasm_v9_bg-')));
    assert.ok([...loaded].some(path => path.startsWith('midnight_onchain_runtime_wasm_bg-a10579365a8bf303abdcedef906f4bdf4a159f189f19c86c654bd75d0a0c870d')));
  } finally {
    globalThis.fetch = originalFetch;
    assert.ok(dirname(folder) === resolve(tmpdir()) && basename(folder).startsWith('ballot-sdk-initialization-'));
    await rm(folder, { recursive: true, force: true });
  }
});
