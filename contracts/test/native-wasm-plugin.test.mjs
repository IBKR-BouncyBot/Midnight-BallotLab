// Real esbuild plus the installed official WASM: packaging/privacy only.
// This does not execute an election, generate proofs or confirm transactions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as esbuild from 'esbuild';
import { nativeWasmPlugin } from '../../scripts/native-wasm-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const wasmFile = join(dirname(fileURLToPath(import.meta.resolve('@midnightntwrk/onchain-runtime-v4'))), 'midnight_onchain_runtime_wasm_bg.wasm');
const options = {
  absWorkingDir: root,
  stdin: { contents: 'export * from "@midnightntwrk/onchain-runtime-v4";',
    sourcefile: 'native-wasm-packaging-test.mjs', resolveDir: join(root, 'contracts') },
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
  assert.ok(ids.length === 1 && ids[0] === 'native-wasm:contracts/node_modules/@midnightntwrk/onchain-runtime-v4/midnight_onchain_runtime_wasm_bg.wasm',
    'WASM module identity must be the expected project-relative path');
  const output = result.outputFiles.map(file => file.text).join('\n');
  for (const prefix of [root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')]) {
    assert.equal(output.includes(prefix), false, 'Bundle must not contain the absolute project root');
  }
  assert.ok(/native-wasm:contracts\/node_modules\/@midnightntwrk\/onchain-runtime-v4\//.test(output),
    'Bundle must retain the expected project-relative WASM module identity');
});

test('WASM outside the declared project root fails closed', async () => {
  await assert.rejects(esbuild.build({ ...options,
    plugins: [nativeWasmPlugin(new Map(), { projectRoot: join(root, 'src') })],
  }), /Native WASM module must be inside the project root/);
});

test('actual official ZKIR worker bundles separately with unchanged non-shared WASM and no external dependencies', async () => {
  const assets = new Map();
  const result = await esbuild.build({ ...options, stdin: undefined,
    entryPoints: [join(root, 'contracts/native/wasm-prover-worker.mjs')],
    outfile: join(root, 'dist/native-prover-worker.mjs'),
    define: { __NATIVE_PROVER_MANIFEST_SHA256__: JSON.stringify('0'.repeat(64)) },
    plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'network-assets', verifyIntegrity: true })],
  });
  assert.equal(result.warnings.length, 0);
  assert.equal(result.outputFiles.length, 1);
  assert.equal(assets.size, 1);
  const officialFile = join(root, 'contracts/node_modules/@midnightntwrk/zkir-v3/midnight_zkir_wasm_bg.wasm');
  const official = await readFile(officialFile);
  assert.ok(Buffer.from([...assets.values()][0]).equals(official));
  assert.equal(createHash('sha256').update(official).digest('hex'), '5c81a400f7bc110c0c65a1889c1e241a4055efdb722e8e512b459ab6d2f80255');
  assert.ok(Object.keys(result.metafile.inputs).some(id => id.startsWith('native-wasm:contracts/node_modules/@midnightntwrk/zkir-v3/')));
  assert.equal(Object.values(result.metafile.outputs).flatMap(output => output.imports).some(item => item.external), false);
  const output = result.outputFiles[0].text;
  assert.ok(output.includes('Native WASM asset integrity check failed'));
  assert.ok(output.includes('5c81a400f7bc110c0c65a1889c1e241a4055efdb722e8e512b459ab6d2f80255'));
  for (const prefix of [root, root.replaceAll('\\', '/'), root.replaceAll('\\', '\\\\')]) assert.equal(output.includes(prefix), false);
  assert.equal(/SharedArrayBuffer|initThreadPool|Atomics\./.test(output), false);
  // Inspect the actual pinned binary's memory declarations; this is a package
  // property test, not a claim that a proof was produced.
  let offset = 8; const flags = [];
  const uint = () => {
    let value = 0, shift = 0, byte;
    do { byte = official[offset++]; value += (byte & 127) * 2 ** shift; shift += 7; assert.ok(shift <= 35); } while (byte & 128);
    return value;
  };
  while (offset < official.length) {
    const section = official[offset++], size = uint(), end = offset + size;
    if (section === 5) {
      const count = uint();
      for (let i = 0; i < count; i++) { const flag = uint(); flags.push(flag); uint(); if (flag & 1) uint(); }
    }
    offset = end;
  }
  assert.deepEqual(flags, [0]);
  assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(official)).filter(item => item.kind === 'memory'), []);
});

test('strict loader instantiates real ZKIR and rejects changed or truncated decoded bytes even with compressed delivery headers', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ballot-wasm-loader-'));
  const originalFetch = globalThis.fetch;
  try {
    const official = await readFile(join(root, 'contracts/node_modules/@midnightntwrk/zkir-v3/midnight_zkir_wasm_bg.wasm'));
    const built = await esbuild.build({ ...options,
      stdin: { contents: 'export * from "@midnightntwrk/zkir-v3";', sourcefile: 'zkir-loader-test.mjs', resolveDir: join(root, 'contracts') },
      outfile: join(folder, 'loader.mjs'),
      plugins: [nativeWasmPlugin(new Map(), { projectRoot: root, assetFolder: 'network-assets', verifyIntegrity: true })],
    });
    await writeFile(join(folder, 'loader.mjs'), built.outputFiles[0].contents);
    let payload = official, calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++; assert.ok(new URL(url).pathname.endsWith('/network-assets/midnight_zkir_wasm_bg-5c81a400f7bc110c0c65a1889c1e241a4055efdb722e8e512b459ab6d2f80255.wasm'));
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.body, undefined);
      // Fetch exposes decoded bytes, while this header can describe a smaller
      // compressed wire representation. No network request is made by this test.
      return new Response(payload, { headers: { 'content-length': '1024', 'content-encoding': 'gzip' } });
    };
    const url = pathToFileURL(join(folder, 'loader.mjs')).href;
    const actual = await import(`${url}?valid`);
    assert.equal(typeof actual.prove, 'function'); assert.equal(typeof actual.Zkir.deserialize, 'function');
    payload = Buffer.from(official); payload[payload.length - 1] ^= 1;
    await assert.rejects(import(`${url}?changed`), /Native WASM asset integrity check failed/);
    payload = official.subarray(0, official.length - 1);
    await assert.rejects(import(`${url}?short`), /Native WASM asset integrity check failed/);
    assert.equal(calls, 3);
  } finally { globalThis.fetch = originalFetch; await rm(folder, { recursive: true, force: true }); }
});

test('browser bundle initializes the real native app modules and awaited generated constructor', { timeout: 20_000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ballot-native-initialization-'));
  const originalFetch = globalThis.fetch;
  const assets = new Map();
  try {
    const built = await esbuild.build({ ...options,
      stdin: { contents: 'export { initNativeDemo } from "./src/native-app.mjs"; export { createNativeEmulator } from "./contracts/native/harness.mjs";',
        sourcefile: 'native-initialization-test.mjs', resolveDir: root },
      outfile: join(folder, 'native.mjs'),
      plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'native-assets' })],
    });
    assert.equal(built.warnings.length, 0);
    assert.equal(assets.size, 1);
    await writeFile(join(folder, 'native.mjs'), built.outputFiles[0].contents);
    let wasmLoads = 0;
    globalThis.fetch = async url => {
      const path = new URL(url).pathname.split('/native-assets/')[1];
      const bytes = assets.get(`native-assets/${path}`);
      assert.ok(bytes, 'Only the actual bundled runtime WASM may be fetched');
      wasmLoads++; return new Response(bytes, { headers: { 'content-type': 'application/wasm' } });
    };
    const native = await import(pathToFileURL(join(folder, 'native.mjs')).href);
    assert.equal(typeof native.initNativeDemo, 'function');
    const bytes = last => { const value = new Uint8Array(32); value[31] = last; return value; };
    const emulator = await native.createNativeEmulator({ electionId: bytes(10), manifestDigest: bytes(11),
      administratorSecret: bytes(1), setupSecret: 11n, setupSlope: 7n,
      opensAt: 2_000_000_000, closesAt: 2_000_000_600, candidateCount: 3 });
    assert.equal(emulator.readLedger().keysConfigured, true);
    assert.equal(emulator.readLedger().phase, 0n);
    await emulator.call('enroll', emulator.pureCircuits.memberIdentity(bytes(10), bytes(2)));
    emulator.setTime(2_000_000_000);
    await emulator.call('openVoting');
    assert.equal(emulator.readLedger().phase, 1n);
    emulator.setPrivateState({});
    assert.equal(wasmLoads, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(folder, { recursive: true, force: true });
  }
});
