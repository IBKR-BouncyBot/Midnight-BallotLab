import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, truncate, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CLI_JSON_LIMIT } from '../src/json.mjs';

const script = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
const example = fileURLToPath(new URL('../examples/synthetic-election.public.json', import.meta.url));
const fingerprints = JSON.parse(await readFile(new URL('../examples/synthetic-election.fingerprints.json', import.meta.url), 'utf8'));
function cli(path, args = [], nodeArgs = []) {
  const result = spawnSync(process.execPath, [...nodeArgs, script, path, ...args], { encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error);
  return result;
}
async function temporary(run) {
  const directory = await mkdtemp(join(tmpdir(), 'ballot-lab-cli-'));
  try { await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('CLI still verifies the public example with both original fingerprints', () => {
  const result = cli(example, ['--manifest-hash', fingerprints.manifestHash, '--record-hash', fingerprints.recordHash, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.anchored, true);
  assert.deepEqual(report.tally, [2, 1, 2]);
});

test('CLI rejects duplicate-key and integer-spelling aliases before verification', async () => {
  const original = await readFile(example, 'utf8');
  await temporary(async directory => {
    const variants = [
      [original.replace('{', '{"tally":[999,999,999],'), /Duplicate JSON object field/],
      [original.replace(/"threshold":\s*2/, '"threshold":2e0'), /Fractional or exponent-form/],
      [original.replace(/"threshold":\s*2/, '"threshold":2.0'), /Fractional or exponent-form/],
    ];
    for (let i = 0; i < variants.length; i++) {
      const [content, error] = variants[i];
      const path = join(directory, `${i}.json`);
      await writeFile(path, content);
      const result = cli(path, ['--manifest-hash', fingerprints.manifestHash, '--record-hash', fingerprints.recordHash]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, error);
      assert(!result.stdout.includes('PASS'));
    }
  });
});

test('CLI rejects an oversized sparse file before reading its body', async () => {
  await temporary(async directory => {
    const path = join(directory, 'oversized.json');
    await writeFile(path, '');
    await truncate(path, CLI_JSON_LIMIT + 1);
    const result = cli(path, [], ['--max-old-space-size=32']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /64 MiB input limit/);
    assert(!result.stderr.includes('heap out of memory'));
  });
});

test('CLI rejects malformed UTF-8 input', async () => {
  await temporary(async directory => {
    const path = join(directory, 'invalid-utf8.json');
    await writeFile(path, Buffer.from([0x22, 0xff, 0x22]));
    const result = cli(path);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /valid UTF-8/);
  });
});

test('CLI reports missing final-record authentication when only a manifest is pinned', () => {
  const result = cli(example, ['--manifest-hash', fingerprints.manifestHash]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /WARNING No independently trusted final-record fingerprint was supplied/);
});
