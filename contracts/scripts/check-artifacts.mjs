// Checks output from the REAL compiler. Never fabricates generated bindings,
// circuits or keys. Presence/module loading is not a proof or network test.
import { readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const target = process.argv[2] ?? 'native';
if (target !== 'native' || process.argv.length > 3) throw new Error('Expected the native artifact target');
const generated = new URL('../managed/native-election/', import.meta.url);

async function regularFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in generated output: ${path}`);
    if (entry.isDirectory()) files.push(...await regularFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

for (const file of ['contract/index.js', 'contract/index.d.ts']) {
  const info = await stat(new URL(file, generated));
  if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty compiler binding: ${file}`);
}
const counts = {};
for (const directory of ['compiler', 'keys', 'zkir']) {
  const files = await regularFiles(fileURLToPath(new URL(`${directory}/`, generated)));
  if (!files.length) throw new Error(`No generated files in ${directory}/; full compilation is required`);
  for (const file of files) {
    if ((await stat(file)).size === 0) throw new Error(`Empty generated artifact: ${file}`);
  }
  counts[directory] = files.length;
}

// Loading generated bindings exercises the compiler/runtime version check.
const bindings = await import(new URL('contract/index.js', generated));
if (typeof bindings.Contract !== 'function' || typeof bindings.ledger !== 'function'
    || typeof bindings.pureCircuits !== 'object') {
  throw new Error('Generated election bindings do not expose the required interface');
}
console.log(JSON.stringify({ check: 'generated-native-artifacts', target, files: counts,
  runtimeImport: 'passed', proofExecution: 'not-tested', ledgerSubmission: 'not-tested' }));
