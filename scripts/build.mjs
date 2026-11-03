import { readFile, writeFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, 'src'), dist, { recursive: true });
// This entry imports real generated bindings and must be bundled separately.
// The static shell never attempts to run an unbuilt native entry.
await rm(join(dist, 'native-app.mjs'), { force: true });
await rm(join(dist, 'network-app.mjs'), { force: true });
await rm(join(dist, 'network-receipt.mjs'), { force: true });
await writeFile(join(dist, 'native-build.json'), JSON.stringify({
  enabled: false,
  reason: 'The native compiler output and browser bundle are not included in this build.',
}) + '\n');
await writeFile(join(dist, 'network-build.json'), JSON.stringify({
  enabled: false,
  reason: 'The network provider bundle and generated contract assets are not included in this build.',
}) + '\n');
await cp(join(root, 'docs'), join(dist, 'docs'), { recursive: true });
// Keep relative links from the published compatibility guide usable.
await mkdir(join(dist, 'contracts'), { recursive: true });
for (const name of ['README.md', 'native-election.compact']) {
  await cp(join(root, 'contracts', name), join(dist, 'contracts', name));
}
await mkdir(join(dist, 'contracts', 'native'), { recursive: true });
await cp(join(root, 'contracts', 'native', 'README.md'), join(dist, 'contracts', 'native', 'README.md'));
// GitHub Pages should publish the generated files without Jekyll processing.
await writeFile(join(dist, '.nojekyll'), '');

// ZIP store format, no external build-time or runtime dependencies.
const crcTable = Array.from({length: 256}, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const b of bytes) value = crcTable[(value ^ b) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
async function list(dir) {
  const files = [];
  for (const entry of (await readdir(dir, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (['node_modules', '__pycache__', '.git', 'managed', '.runtime', 'private-state', '.npm-cache', 'logs', 'artifacts', 'dist'].includes(entry.name) || /\.(?:pyc|secret\.json)$/.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Symlinks are excluded from release');
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await list(path)); else files.push(path);
  }
  return files;
}
const sourcePaths = [];
for (const path of ['src', 'contracts', 'tests', 'scripts', 'docs', '.github', 'evidence']) {
  sourcePaths.push(...await list(join(root,path)).catch(e=>{if(e.code==='ENOENT')return [];throw e;}));
}
for (const name of ['README.md','LICENSE','package.json','.gitignore','.gitattributes','AGENTS.md']) sourcePaths.push(join(root,name));
const locals=[], central=[];
let offset=0;
for (const file of sourcePaths) {
  const contents=await readFile(file);
  const filename=Buffer.from('midnight-ballot-lab/'+relative(root,file).replaceAll('\\','/'));
  const crc=crc32(contents);
  const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);
  header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(contents.length,18);
  header.writeUInt32LE(contents.length,22);header.writeUInt16LE(filename.length,26);
  locals.push(header,filename,contents);
  const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);
  cd.writeUInt16LE(0x800,8);cd.writeUInt16LE(33,14);cd.writeUInt32LE(crc,16);
  cd.writeUInt32LE(contents.length,20);cd.writeUInt32LE(contents.length,24);cd.writeUInt16LE(filename.length,28);cd.writeUInt32LE(offset,42);
  central.push(cd,filename);offset+=header.length+filename.length+contents.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);
end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(sourcePaths.length,8);end.writeUInt16LE(sourcePaths.length,10);
end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await writeFile(join(dist,'midnight-ballot-lab-source.zip'),Buffer.concat([...locals,directory,end]));
await writeFile(join(dist,'_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Content-Security-Policy: default-src \'self\'; script-src \'self\' \'wasm-unsafe-eval\'; style-src \'self\'; style-src-attr \'unsafe-inline\'; font-src \'self\'; img-src \'self\' data: blob:; connect-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'none\'\n');
console.log(JSON.stringify({built:'dist',sourceFiles:sourcePaths.length,sourceArchive:'dist/midnight-ballot-lab-source.zip'}));
