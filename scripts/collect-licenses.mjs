// Preserve the available license/notice texts of the installed application graph.
import { readFile, readdir, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export async function collectDependencyNotices(root, dist) {
  const contracts = join(root, 'contracts');
  const lock = JSON.parse(await readFile(join(contracts, 'package-lock.json'), 'utf8'));
  const notices = [];
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue;
    const directory = resolve(contracts, location);
    if (!directory.startsWith(resolve(contracts, 'node_modules') + sep)) throw new Error('Unexpected dependency path');
    let pkg;
    try { pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (typeof pkg.name !== 'string' || !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkg.name) || !/^[a-z0-9.+_-]+$/i.test(pkg.version)) throw new Error('Unexpected package identity');
    const destination = `third-party/${pkg.name.replaceAll('/', '__')}@${pkg.version}`;
    const files = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && /^(licen[sc]e|copying|copyright|notice)(\.[a-z0-9._-]+)?$/i.test(file.name));
    await mkdir(join(dist, destination), { recursive: true });
    for (const file of files) await copyFile(join(directory, file.name), join(dist, destination, file.name));
    notices.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? entry.license ?? 'See upstream package notices',
      files: files.map(file => `${destination}/${file.name}`) });
  }
  await mkdir(join(dist, 'third-party'), { recursive: true });
  await writeFile(join(dist, 'third-party/index.json'), JSON.stringify({
    scope: 'Installed application dependencies; original third-party licenses remain in force. Bundles also retain legal comments.',
    packages: notices,
  }, null, 2) + '\n');
  return notices.length;
}
