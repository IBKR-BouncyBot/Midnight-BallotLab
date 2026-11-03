// Stage byte-identical application code into this isolated dependency graph.
// This does not generate bindings, execute a wallet, or change the source files.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const contracts = resolve(directory, '..');
const runtime = join(directory, '.runtime');
const files = ['native/sdk-client.mjs', 'native/adapter.mjs', 'native/harness.mjs', 'native/record.mjs',
  'native/browser-config.mjs', 'native/test/native-election.test.mjs', 'managed/native-election/contract/index.js'];

export async function stageRuntime() {
  const hashes = {};
  for (const path of files) {
    const bytes = await readFile(join(contracts, path));
    if (!bytes.length) throw new Error('A required native application source file is empty');
    const destination = join(runtime, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
  }
  return { runtime, hashes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await stageRuntime();
  console.log(JSON.stringify({ stage: 'byte-identical-native-runtime', sourceHashes: result.hashes,
    generatedRuntimeExecution: false, proofGeneration: false, networkSubmission: false }));
}
