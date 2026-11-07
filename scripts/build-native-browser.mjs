// Optional REAL native browser build. Requires generated Compact output and the
// pinned npm packages; never replaces unavailable Midnight code with a mock.
// esbuild 0.28.2 fixes async module-wrapper propagation in dependency cycles.
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = join(root, 'contracts');
const dist = join(root, 'dist');
const bundlePath = join(dist, 'native-bundle.mjs');
const manifestPath = join(dist, 'native-build.json');
const assetDirectory = join(dist, 'native-assets');
const generated = join(contracts, 'managed/native-election/contract/index.js');
const source = join(root, 'src/native-app.mjs');
const assets = new Map();

async function requireFile(path, message) {
  const info = await stat(path).catch(() => undefined);
  if (!info?.isFile() || info.size === 0) throw new Error(message);
}


try {
  await requireFile(join(dist, 'native.html'), 'Run npm run build from the repository root before the native browser build');
  // Disable stale success and remove stale artifacts before any new attempt.
  await writeFile(manifestPath, JSON.stringify({ enabled: false, reason: 'Native browser build has not completed.' }, null, 2) + '\n');
  await rm(bundlePath, { force: true });
  await rm(assetDirectory, { recursive: true, force: true });
  await requireFile(generated, 'Native browser build requires real Compact output. Run npm --prefix contracts run compile:native first.');
  await requireFile(source, 'Native browser entry src/native-app.mjs is missing');

  const requireFromContracts = createRequire(join(contracts, 'package.json'));
  let esbuild;
  try {
    esbuild = await import(pathToFileURL(requireFromContracts.resolve('esbuild')).href);
  } catch (cause) {
    throw new Error('Native browser build requires the pinned esbuild package. Install contracts dependencies, including devDependencies.', { cause });
  }
  if (esbuild.version !== '0.28.2') throw new Error(`Expected esbuild 0.28.2; found ${esbuild.version}`);
  const pins = JSON.parse(await readFile(join(contracts, 'toolchain.json'), 'utf8'));
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: [source], outfile: bundlePath,
    bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    nodePaths: [join(contracts, 'node_modules')], mainFields: ['browser', 'module', 'main'],
    conditions: ['browser', 'import'], plugins: [nativeWasmPlugin(assets, { projectRoot: root })],
    splitting: false, write: false, metafile: true, sourcemap: false,
    minify: false, legalComments: 'inline', logLevel: 'warning',
  });
  if (result.warnings.length) throw new Error('Native browser build emitted warnings that require review before enabling the bundle');
  const external = Object.values(result.metafile.outputs).flatMap(output => output.imports)
    .filter(item => item.external);
  if (external.length) throw new Error('Native browser bundle still has external imports');
  const inputs = Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  if (!inputs.some(path => path.endsWith('managed/native-election/contract/index.js'))
      || !inputs.some(path => path.includes('/@midnight-ntwrk/compact-runtime/'))
      || !inputs.some(path => path.includes('/@midnightntwrk/onchain-runtime-v4/'))) {
    throw new Error('Browser bundle must contain generated native election code and the actual pinned Midnight runtimes');
  }
  if (!assets.size) throw new Error('No actual native WASM was packaged; inspect the installed runtime export format');
  const output = result.outputFiles.find(file => resolve(file.path) === bundlePath);
  if (!output?.contents.length) throw new Error('Native browser bundle is missing or empty');
  if (result.outputFiles.length !== 1) throw new Error('Unexpected additional browser outputs; all assets must be explicitly packaged');
  // Unhandled dynamic WASM URLs cannot silently point back into node_modules.
  const unhandledWasm = [...output.text.matchAll(/new URL\(\s*['"]([^'"]+\.wasm)['"]/g)]
    .some(match => !match[1].startsWith('./native-assets/'));
  if (unhandledWasm) throw new Error('Unresolved native WASM URL remains in the browser output');
  await mkdir(assetDirectory, { recursive: true });
  for (const [path, bytes] of assets) await writeFile(join(dist, path), bytes);
  await writeFile(bundlePath, output.contents);
  await writeFile(manifestPath, JSON.stringify({ enabled: true, bundle: 'native-bundle.mjs',
    assets: [...assets.keys()].sort(), compiler: pins.compiler, runtime: pins.runtime,
    mode: 'local-native-emulator', proofGeneration: false, networkSubmission: false,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ built: relative(root, bundlePath), bytes: output.contents.length,
    wasmAssets: assets.size, nativeBrowserExecution: 'not-tested', proofExecution: 'not-tested' }));
} catch (error) {
  await rm(bundlePath, { force: true }).catch(() => {});
  await rm(assetDirectory, { recursive: true, force: true }).catch(() => {});
  await writeFile(manifestPath, JSON.stringify({ enabled: false,
    reason: 'Native browser build did not complete. Install the pinned tooling and compile the native contract.' }, null, 2) + '\n').catch(() => {});
  console.error(`Native browser build failed: ${error.message}`);
  console.error('No substitute encryption runtime was created. The native browser mode remains disabled.');
  process.exitCode = 1;
}
