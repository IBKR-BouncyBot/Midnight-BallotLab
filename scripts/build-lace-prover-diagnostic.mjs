/** Separate test site only; a fresh output directory is required. */
import { cp, mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, join, dirname, sep, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { nativeWasmPlugin } from './native-wasm-plugin.mjs';
import { decodeJsonUtf8, parseStrictJson } from '../src/json.mjs';
import { validateNativeProverManifest } from '../contracts/native/wasm-prover-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function buildLaceProverDiagnostic(destination, { checkOnly = false } = {}) {
  if (typeof destination !== 'string' || !isAbsolute(destination)) throw new Error('A fresh diagnostic output directory is required');
  const output = resolve(destination), parent = await realpath(dirname(output));
  const allowed = await realpath(process.env.GITHUB_ACTIONS === 'true' ? process.env.RUNNER_TEMP : join(root, 'artifacts'));
  if (parent !== allowed && !parent.startsWith(allowed + sep)) throw new Error('Diagnostic output must remain in the task artifact directory');
  const contractRoot = join(root, 'contracts'), requireContracts = createRequire(join(contractRoot, 'package.json'));
  const esbuild = await import(pathToFileURL(requireContracts.resolve('esbuild')).href);
  const network = JSON.parse(await readFile(join(root, 'dist/network-build.json'), 'utf8'));
  const manifestBytes = await readFile(join(root, 'dist/native-contract/prover-manifest.json'));
  const manifest = validateNativeProverManifest(parseStrictJson(decodeJsonUtf8(manifestBytes), { maxBytes: 64 * 1024, maxDepth: 8 }));
  if (!network.enabled || hash(manifestBytes) !== network.browserProver?.manifest?.sha256
      || manifest.circuits.get('openVoting')?.k !== 8) throw new Error('The actual built proving assets are required');
  const assets = new Map();
  const result = await esbuild.build({
    absWorkingDir: root, entryPoints: [join(contractRoot, 'native/lace-prover-diagnostic.mjs')],
    outfile: join(output, 'lace-diagnostic-bundle.mjs'), bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    define: { __LACE_DIAGNOSTIC_MANIFEST_SHA256__: JSON.stringify(hash(manifestBytes)) },
    nodePaths: [join(contractRoot, 'node_modules')], mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import'],
    plugins: [nativeWasmPlugin(assets, { projectRoot: root, assetFolder: 'lace-diagnostic-assets', verifyIntegrity: true,
      browserPackages: { buffer: requireContracts.resolve('buffer/'), events: requireContracts.resolve('events/'),
        assert: requireContracts.resolve('assert/'), 'process/browser.js': requireContracts.resolve('process/browser.js') } })],
    write: false, metafile: true, sourcemap: false, legalComments: 'inline', logLevel: 'silent',
  });
  if (result.warnings.length || result.outputFiles.length !== 1
      || Object.values(result.metafile.outputs).flatMap(item => item.imports).some(item => item.external)) {
    throw new Error('The diagnostic bundle did not build completely');
  }
  const build = { schema: 'midnight-ballot-lab/lace-fundless-diagnostic-build/v1',
    harnessSha256: hash(result.outputFiles[0].contents), assetManifestSha256: hash(manifestBytes),
    sourceSha256: hash(await readFile(join(contractRoot, 'native/lace-prover-diagnostic.mjs'))),
    circuit: 'openVoting', proofGeneration: 'not-tested-by-build' };
  if (!checkOnly) {
    // cp creates the destination and refuses an existing file or directory.
    // Creating it first would make errorOnExist reject our own empty folder.
    await cp(join(root, 'dist'), output, { recursive: true, force: false, errorOnExist: true });
    await mkdir(join(output, 'lace-diagnostic-assets'));
    for (const [path, bytes] of assets) await writeFile(join(output, path), bytes, { flag: 'wx' });
    await writeFile(join(output, 'lace-diagnostic-bundle.mjs'), result.outputFiles[0].contents, { flag: 'wx' });
    await writeFile(join(output, 'lace-prover-diagnostic.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'"><title>Fundless Lace contract proof diagnostic</title><link rel="stylesheet" href="./lace-diagnostic.css"></head><body><main><h1>Fundless Lace contract proof diagnostic</h1><p>Test only. This creates one real contract proof through Lace, using synthetic inputs held in this page. It does not test DUST proofs, sign or submit a transaction. The page policy does not constrain extension traffic.</p><button id="lace-diagnostic-connect" disabled>Connect the empty Preview test wallet</button><button id="lace-diagnostic-run" disabled>Run one real openVoting proof</button><p id="lace-diagnostic-status" role="status">Loading the real Midnight runtime…</p><pre id="lace-diagnostic-report"></pre></main><script type="module" src="./lace-diagnostic-bundle.mjs"></script></body></html>\n`, { flag: 'wx' });
    await writeFile(join(output, 'lace-diagnostic.css'), 'body{background:#080808;color:white;font:18px system-ui;padding:32px}main{max-width:1000px;margin:auto}button{background:#0000fe;color:white;padding:14px;border:1px solid white;margin:4px}button:disabled{opacity:.5}pre{font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}\n', { flag: 'wx' });
    await writeFile(join(output, 'lace-diagnostic-build.json'), JSON.stringify(build, null, 2) + '\n', { flag: 'wx' });
  }
  return build;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await buildLaceProverDiagnostic(process.argv[2]))); }
  catch { console.error('The separate Lace diagnostic site could not be built; raw filesystem diagnostics were withheld.'); process.exitCode = 1; }
}
