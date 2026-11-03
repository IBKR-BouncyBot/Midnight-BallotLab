import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compactInvocation } from './compact-launcher.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const target = process.argv[2] ?? 'native';
if (target !== 'native' || process.argv.length > 3) throw new Error('Expected the native compile target');
const source = 'native-election.compact', directory = 'native-election';
const pins = JSON.parse(await readFile(new URL('../toolchain.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pins.compiler)) throw new Error('Invalid pinned compiler version');
const selector = `+${pins.compiler}`;
const launch = compactInvocation({ cwd });
const version = spawnSync(launch.command, [...launch.args, 'compile', selector, '--version'], {
  cwd, encoding: 'utf8', shell: false,
});

if (version.error || version.status !== 0) {
  console.error('Compact compilation did not run:', version.error?.message ?? version.stderr.trim());
  console.error(`Install official Compact devtools, then run: compact update ${pins.compiler}`);
  console.error('No native compatibility or deployment is established by this failure.');
  process.exitCode = 1;
} else {
  const reported = (version.stdout + version.stderr).trim();
  const escaped = pins.compiler.replaceAll('.', '\\.');
  if (!new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(reported)) {
    throw new Error(`Pinned compiler ${pins.compiler} was requested but version output was: ${reported}`);
  }
  console.log(`Using Compact toolchain ${pins.compiler}: ${reported}`);
  // Generated output is disposable. Removing it prevents a failed or partial
  // compile from being mistaken for a successful build using residual output.
  await rm(new URL(`../managed/${directory}/`, import.meta.url), { recursive: true, force: true });
  const result = spawnSync(launch.command, [
    ...launch.args, 'compile', selector, source, `managed/${directory}`,
  ], { cwd, stdio: 'inherit', shell: false });
  if (result.error) console.error('Compact compilation failed:', result.error.message);
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) await import('./check-artifacts.mjs');
}
