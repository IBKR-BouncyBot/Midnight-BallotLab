// Real SDK/browser build. A manifest is enabled only after actual generated
// bindings, official runtime WASM and every circuit's ZK files are packaged.
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';
import { prepareBrowserProverParameters } from './prepare-browser-prover-parameters.mjs';
import { NATIVE_PROVER_CIRCUITS, NATIVE_PROVER_ASSET_SCHEMA, validateNativeProverManifest } from '../contracts/native/wasm-prover-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = join(root, 'contracts');
const dist = join(root, 'dist');
const generated = join(contracts, 'managed/native-election');
const bundlePath = join(dist, 'network-bundle.mjs');
const workerPath = join(dist, 'native-prover-worker.mjs');
const manifestPath = join(dist, 'network-build.json');
const wasmDirectory = join(dist, 'network-assets');
const contractDirectory = join(dist, 'native-contract');
const circuitNames = ['configureKeys', 'enroll', 'openVoting', 'castBallot', 'closeVoting', 'submitDecryption', 'finalize'];
const wasmAssets = new Map();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function actualFile(path, description) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size === 0) throw new Error(`Missing or empty ${description}`);
  return readFile(path);
}

async function disable() {
  await writeFile(manifestPath, JSON.stringify({ enabled: false,
    reason: 'The real network browser bundle and complete generated proving assets have not been built.' }, null, 2) + '\n');
}

try {
  await actualFile(join(dist, 'network.html'), 'network page: run the root build first');
  await disable();
  await rm(bundlePath, { force: true });
  await rm(workerPath, { force: true });
  await rm(wasmDirectory, { recursive: true, force: true });
  await rm(contractDirectory, { recursive: true, force: true });
  await actualFile(join(generated, 'contract/index.js'), 'real generated native bindings');
  // This import runs the generated compiler/runtime version check. It does not
  // execute a contract, generate a proof, or claim network compatibility alone.
  const bindings = await import(pathToFileURL(join(generated, 'contract/index.js')).href);
  if (typeof bindings.Contract !== 'function' || typeof bindings.pureCircuits?.receiptDigest !== 'function') {
    throw new Error('Generated native contract interface is incomplete');
  }
  const proofAssets = new Map();
  for (const circuit of circuitNames) {
    for (const [directory, extension] of [['keys', 'prover'], ['keys', 'verifier'], ['zkir', 'bzkir']]) {
      const path = `${directory}/${circuit}.${extension}`;
      proofAssets.set(path, await actualFile(join(generated, path), `generated circuit asset ${path}`));
    }
  }
  const requireContracts = createRequire(join(contracts, 'package.json'));
  const esbuild = await import(pathToFileURL(requireContracts.resolve('esbuild')).href);
  if (esbuild.version !== '0.25.12') throw new Error('Expected pinned esbuild 0.25.12');
  const pins = JSON.parse(await readFile(join(contracts, 'toolchain.json'), 'utf8'));
  const proverPackage = JSON.parse(await readFile(join(contracts, 'node_modules/@midnight-ntwrk/zkir-v2/package.json'), 'utf8'));
  if (proverPackage.version !== '2.1.1') throw new Error('Expected official ZKIR prover 2.1.1');
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: [join(root, 'src/network-app.mjs')], outfile: bundlePath,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    nodePaths: [join(contracts, 'node_modules')], mainFields: ['browser', 'module', 'main'],
    conditions: ['browser', 'import'],
    inject: [join(root, 'scripts/network-browser-globals.mjs')],
    plugins: [nativeWasmPlugin(wasmAssets, { projectRoot: root, assetFolder: 'network-assets', browserPackages: {
      // These are actual installed browser implementations, not empty Node stubs.
      events: requireContracts.resolve('events/'), buffer: requireContracts.resolve('buffer/'),
      assert: requireContracts.resolve('assert/'),
    } })],
    splitting: false, write: false, metafile: true, sourcemap: false,
    minify: false, legalComments: 'inline', logLevel: 'warning',
  });
  if (result.warnings.length) throw new Error('Network browser warnings require review');
  if (Object.values(result.metafile.outputs).flatMap(output => output.imports).some(item => item.external)) {
    throw new Error('Network browser output contains an unresolved external dependency');
  }
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  for (const required of ['managed/native-election/contract/index.js', '/@midnight-ntwrk/compact-runtime/',
    '/@midnight-ntwrk/onchain-runtime-v3/', '/@midnight-ntwrk/ledger-v8/', '/@midnight-ntwrk/midnight-js-contracts/',
    '/@midnight-ntwrk/midnight-js-types/']) {
    if (!inputs.some(path => path.includes(required))) throw new Error(`Required real implementation absent: ${required}`);
  }
  const browserSources = new Set(['src/network-app.mjs', 'src/network-navigation.mjs', 'src/network-receipt.mjs', 'src/network-timing.mjs', 'src/network-voting.mjs', 'src/voter-file-label.mjs', 'src/private-key.mjs', 'src/election-join.mjs', 'src/trustee-key.mjs', 'src/key-file-json.mjs', 'src/json.mjs', 'src/qr.mjs']);
  if (inputs.some(path => path.startsWith('src/') && !browserSources.has(path))) {
    throw new Error('Network bundle contains an unreviewed browser source');
  }
  if (wasmAssets.size < 2) throw new Error('Expected both real onchain-runtime and ledger WASM');
  const output = result.outputFiles.find(file => resolve(file.path) === bundlePath);
  if (!output?.contents.length || result.outputFiles.length !== 1) throw new Error('Unexpected or empty network output');
  if ([...output.text.matchAll(/new URL\(\s*['"]([^'"]+\.wasm)['"]/g)].some(match => !match[1].startsWith('./network-assets/'))) {
    throw new Error('Unhandled WASM location in network output');
  }
  const zkir = await import(pathToFileURL(requireContracts.resolve('@midnight-ntwrk/zkir-v2')).href);
  for (const name of circuitNames) {
    const parsed = zkir.Zkir.deserialize(proofAssets.get(`zkir/${name}.bzkir`));
    try { if (parsed.getK() !== NATIVE_PROVER_CIRCUITS[name]) throw new Error('Generated circuit parameter size changed; review proving assets'); }
    finally { parsed.free?.(); }
  }
  const parameters = await prepareBrowserProverParameters(root);
  const assetRecord = path => { const bytes = proofAssets.get(path); return { path, bytes: bytes.length, sha256: sha256(bytes) }; };
  const proverManifest = { schema: NATIVE_PROVER_ASSET_SCHEMA, proverVersion: '2.1.1',
    circuits: circuitNames.map(name => ({ name, k: NATIVE_PROVER_CIRCUITS[name],
      prover: assetRecord(`keys/${name}.prover`), verifier: assetRecord(`keys/${name}.verifier`), ir: assetRecord(`zkir/${name}.bzkir`) })),
    params: [...parameters.values()].map(item => item.record),
  };
  validateNativeProverManifest(proverManifest);
  const proverManifestBytes = Buffer.from(JSON.stringify(proverManifest, null, 2) + '\n');
  const workerResult = await esbuild.build({
    absWorkingDir: root, entryPoints: [join(contracts, 'native/wasm-prover-worker.mjs')], outfile: workerPath,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    nodePaths: [join(contracts, 'node_modules')], mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
    define: { __NATIVE_PROVER_MANIFEST_SHA256__: JSON.stringify(sha256(proverManifestBytes)) },
    plugins: [nativeWasmPlugin(wasmAssets, { projectRoot: root, assetFolder: 'network-assets', verifyIntegrity: true })],
    splitting: false, write: false, metafile: true, sourcemap: false, minify: false, legalComments: 'inline', logLevel: 'warning',
  });
  const workerOutput = workerResult.outputFiles.find(file => resolve(file.path) === workerPath);
  const workerInputs = Object.keys(workerResult.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  if (workerResult.warnings.length || workerResult.outputFiles.length !== 1 || !workerOutput?.contents.length
    || Object.values(workerResult.metafile.outputs).flatMap(item => item.imports).some(item => item.external)
    || !workerInputs.some(path => path.includes('/@midnight-ntwrk/zkir-v2/')) || wasmAssets.size !== 3) {
    throw new Error('Official browser proving worker is incomplete');
  }
  if ([...workerOutput.text.matchAll(/new URL\(\s*['"]([^'"]+\.wasm)['"]/g)].some(match => !match[1].startsWith('./network-assets/'))) {
    throw new Error('Unhandled prover WASM location');
  }
  await mkdir(wasmDirectory, { recursive: true });
  for (const [path, bytes] of wasmAssets) await writeFile(join(dist, path), bytes);
  await mkdir(join(contractDirectory, 'keys'), { recursive: true });
  await mkdir(join(contractDirectory, 'zkir'), { recursive: true });
  await mkdir(join(contractDirectory, 'params'), { recursive: true });
  for (const [path, bytes] of proofAssets) await writeFile(join(contractDirectory, path), bytes);
  for (const { record, bytes } of parameters.values()) await writeFile(join(contractDirectory, record.path), bytes);
  await writeFile(join(contractDirectory, 'prover-manifest.json'), proverManifestBytes);
  await writeFile(workerPath, workerOutput.contents);
  await writeFile(bundlePath, output.contents);
  const artifactRecords = [...proofAssets].map(([path, bytes]) => ({ path: `native-contract/${path}`, bytes: bytes.length, sha256: sha256(bytes) }));
  await writeFile(manifestPath, JSON.stringify({ enabled: true, bundle: 'network-bundle.mjs',
    mode: 'development-network-client', compiler: pins.compiler, runtime: pins.runtime, sdk: '4.1.1',
    wasmAssets: [...wasmAssets.keys()].sort(), circuitAssets: artifactRecords,
    browserProver: { version: '2.1.1', execution: 'dedicated-worker',
      worker: { path: 'native-prover-worker.mjs', bytes: workerOutput.contents.length, sha256: sha256(workerOutput.contents) },
      manifest: { path: 'native-contract/prover-manifest.json', bytes: proverManifestBytes.length, sha256: sha256(proverManifestBytes) },
      parameters: [...parameters.values()].map(({ record }) => ({ ...record, path: `native-contract/${record.path}` })),
      proofGeneration: 'not-tested-by-build',
    },
    browserExecution: 'not-tested-by-build', proofGeneration: 'not-tested-by-build', networkAcceptance: 'not-tested-by-build',
  }, null, 2) + '\n');
  console.log(JSON.stringify({ built: relative(root, bundlePath), bytes: output.contents.length,
    wasmAssets: wasmAssets.size, circuitAssets: proofAssets.size,
    circuitAssetBytes: [...proofAssets.values()].reduce((sum, value) => sum + value.length, 0),
    proverWorkerBytes: workerOutput.contents.length, publicParameterBytes: [...parameters.values()].reduce((sum, value) => sum + value.bytes.length, 0),
    browserExecution: 'not-tested', proofGeneration: 'not-tested', networkAcceptance: 'not-tested' }));
} catch (error) {
  await rm(bundlePath, { force: true }).catch(() => {});
  await rm(workerPath, { force: true }).catch(() => {});
  await rm(wasmDirectory, { recursive: true, force: true }).catch(() => {});
  await rm(contractDirectory, { recursive: true, force: true }).catch(() => {});
  await disable().catch(() => {});
  console.error(`Network browser build failed: ${error.message}`);
  process.exitCode = 1;
}
