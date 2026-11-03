// Review actual installed lockfiles without running package lifecycle scripts.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
for (const [name, path] of [['application', 'contracts/package-lock.json'], ['devnet', 'contracts/devnet/package-lock.json']]) {
  const bytes = await readFile(new URL(path, root));
  const lock = JSON.parse(bytes);
  const entries = Object.entries(lock.packages).filter(([key]) => key !== '');
  const missingIntegrity = entries.filter(([, item]) => !item.integrity).map(([key]) => key);
  const unexpectedRegistries = entries.filter(([, item]) => !item.resolved?.startsWith('https://registry.npmjs.org/')).map(([key]) => key);
  const summary = { graph: name, lockfileVersion: lock.lockfileVersion, packageEntries: entries.length,
    packageLockSha256: createHash('sha256').update(bytes).digest('hex'), missingIntegrity, unexpectedRegistries,
    lifecycleScripts: entries.filter(([, item]) => item.hasInstallScript).map(([key]) => key),
    lifecycleScriptsExecuted: false,
    directDependencies: lock.packages[''].dependencies,
    runtimeVersions: entries.filter(([key]) => /@midnight-ntwrk\/(compact-runtime|onchain-runtime-v3|ledger-v8|wallet-sdk|zkir-v2)$/.test(key))
      .map(([key, item]) => ({ name: key, version: item.version })),
    scope: 'Integrity metadata, registry sources and package versions; not a security certification.' };
  await mkdir(new URL('evidence/2026-11-03/', root), { recursive: true });
  await writeFile(new URL(`evidence/2026-11-03/${name}-lockfile-review.json`, root), `${JSON.stringify(summary, null, 2)}\n`);
  if (missingIntegrity.length || unexpectedRegistries.length || lock.lockfileVersion !== 3) throw new Error('Unexpected lockfile metadata');
  console.log(JSON.stringify({ graph: name, packageEntries: entries.length, integrityMetadata: 'present', registrySources: 'npm', packageLockSha256: summary.packageLockSha256 }));
}
