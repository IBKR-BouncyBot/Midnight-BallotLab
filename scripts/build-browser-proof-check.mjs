/** Ignored local test site only. Never modifies the production dist output. */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'artifacts/browser-proof-check');
const contracts = join(root, 'contracts');
const requireContracts = createRequire(join(contracts, 'package.json'));
const esbuild = await import(pathToFileURL(requireContracts.resolve('esbuild')).href);
const manifest = JSON.parse(await readFile(join(root, 'dist/network-build.json'), 'utf8'));
if (!manifest.enabled || manifest.browserProver?.version !== '2.1.1') throw new Error('Build the actual browser prover first');
await mkdir(output, { recursive: true });
await cp(join(root, 'dist'), output, { recursive: true, force: true });
const assets = new Map();
const result = await esbuild.build({
  absWorkingDir: root, entryPoints: [join(contracts, 'native/browser-proof-check.mjs')],
  outfile: join(output, 'proof-check-bundle.mjs'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
  nodePaths: [join(contracts, 'node_modules')], mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
  inject: [join(root, 'scripts/network-browser-globals.mjs')],
  plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'proof-check-assets', browserPackages: {
    buffer: requireContracts.resolve('buffer/'), events: requireContracts.resolve('events/'), assert: requireContracts.resolve('assert/'),
    'process/browser.js': requireContracts.resolve('process/browser.js'),
  } })], write: false, metafile: true, sourcemap: false, legalComments: 'inline', logLevel: 'warning',
});
if (result.warnings.length || result.outputFiles.length !== 1
    || Object.values(result.metafile.outputs).flatMap(item => item.imports).some(item => item.external)) throw new Error('Incomplete proof-check bundle');
if (Object.keys(result.metafile.inputs).map(path => path.replaceAll('\\', '/'))
    .filter(path => path.endsWith('node_modules/process/browser.js')).join() !== 'contracts/node_modules/process/browser.js') {
  throw new Error('The browser process implementation must come from the locked contracts dependencies');
}
await mkdir(join(output, 'proof-check-assets'), { recursive: true });
for (const [path, bytes] of assets) await writeFile(join(output, path), bytes);
await writeFile(join(output, 'proof-check-bundle.mjs'), result.outputFiles[0].contents);
await writeFile(join(output, 'proof-check.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"><title>Actual Midnight browser proof check</title><link rel="stylesheet" href="./proof-check.css"></head><body><main><h1>Actual Midnight browser proof check</h1><p>Test only: fresh synthetic inputs stay in this page and its worker. No wallet, HTTP proof server or network transactions.</p><button id="run-browser-proofs" disabled>Run real browser proofs</button><button id="cancel-browser-proofs" disabled>Stop local proof test</button><button id="download-proof-report" disabled>Download public report</button><p id="proof-state" role="status">Loading the real native runtime…</p><pre id="proof-report"></pre></main><script type="module" src="./proof-check-bundle.mjs"></script></body></html>\n`);
await writeFile(join(output, 'proof-check.css'), 'body{background:#080808;color:#fff;font:18px system-ui;margin:0;padding:32px}main{max-width:1000px;margin:auto}button{background:#0000fe;color:white;padding:14px;border:1px solid white;margin:4px;cursor:pointer}button:disabled{opacity:.5;cursor:default}pre{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await writeFile(join(output, 'proof-check-build.json'), JSON.stringify({ schema: 'midnight-ballot-lab/browser-proof-check-build/v1',
  harnessSha256: hash(result.outputFiles[0].contents), workerSha256: manifest.browserProver.worker.sha256,
  assetManifestSha256: manifest.browserProver.manifest.sha256, proofGeneration: 'not-tested-by-build' }, null, 2) + '\n');
console.log(JSON.stringify({ built: 'artifacts/browser-proof-check/proof-check.html',
  harnessBytes: result.outputFiles[0].contents.length, workerSha256: manifest.browserProver.worker.sha256,
  proofGeneration: 'not-tested-by-build' }));
