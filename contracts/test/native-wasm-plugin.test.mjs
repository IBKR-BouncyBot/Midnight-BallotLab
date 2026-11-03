// Real esbuild plus the installed official WASM: packaging/privacy only.
// This does not execute an election, generate proofs or confirm transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as esbuild from 'esbuild';
import { nativeWasmPlugin } from '../../scripts/native-wasm-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const wasmFile = join(dirname(require.resolve('@midnight-ntwrk/onchain-runtime-v3')), 'midnight_onchain_runtime_wasm_bg.wasm');
const options = {
  absWorkingDir: root,
  stdin: { contents: 'export * from "@midnight-ntwrk/onchain-runtime-v3";',
    sourcefile: 'native-wasm-packaging-test.mjs', resolveDir: root },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  nodePaths: [join(root, 'contracts/node_modules')], mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import'], write: false, metafile: true, logLevel: 'silent',
};

test('actual WASM packaging preserves bytes and excludes filesystem prefixes from module IDs and output', async () => {
  const assets = new Map();
  const result = await esbuild.build({ ...options, plugins: [nativeWasmPlugin(assets, { projectRoot: root })] });
  assert.equal(result.warnings.length, 0);
  assert.equal(assets.size, 1);
  assert.ok(Buffer.from([...assets.values()][0]).equals(await readFile(wasmFile)), 'Packaged official WASM bytes must be unchanged');
  const ids = Object.keys(result.metafile.inputs).filter(id => id.startsWith('native-wasm:'));
  assert.ok(ids.length === 1 && ids[0] === 'native-wasm:contracts/node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
    'WASM module identity must be the expected project-relative path');
  const output = result.outputFiles.map(file => file.text).join('\n');
  for (const prefix of [root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')]) {
    assert.equal(output.includes(prefix), false, 'Bundle must not contain the absolute project root');
  }
  assert.ok(/native-wasm:contracts\/node_modules\/@midnight-ntwrk\/onchain-runtime-v3\//.test(output),
    'Bundle must retain the expected project-relative WASM module identity');
});

test('WASM outside the declared project root fails closed', async () => {
  await assert.rejects(esbuild.build({ ...options,
    plugins: [nativeWasmPlugin(new Map(), { projectRoot: join(root, 'src') })],
  }), /Native WASM module must be inside the project root/);
});
