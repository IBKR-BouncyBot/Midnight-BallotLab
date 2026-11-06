import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBrowserProverParameters, validateParameter, PARAMETER_SIZES } from '../scripts/prepare-browser-prover-parameters.mjs';

test('public proving parameters reject unknown sizes and changed bytes before use', () => {
  assert.throws(() => validateParameter(18, new Uint8Array(32)), /integrity/);
  assert.throws(() => validateParameter(7, new Uint8Array(1)), /integrity/);
  assert.throws(() => validateParameter(7, new Uint8Array(PARAMETER_SIZES[7])), /integrity/);
});

test('public parameter downloader uses only fixed credential-free GETs and rejects bad responses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ballot-public-assets-'));
  try {
    let calls = 0;
    await assert.rejects(prepareBrowserProverParameters(root, { fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com/bls_midnight_2p7');
      assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
      assert.equal(options.body, undefined); assert.equal(options.method, undefined);
      return new Response('not a proving parameter', { status: 404 });
    } }), /Could not prepare the pinned public proving parameter k=7/);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('changed parameter cache fails without fetching or replacing its contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ballot-public-assets-'));
  try {
    const folder = join(root, 'artifacts/browser-prover-params'); await mkdir(folder, { recursive: true });
    const file = join(folder, 'bls_midnight_2p7'); const bytes = Buffer.alloc(PARAMETER_SIZES[7]);
    await writeFile(file, bytes);
    let fetched = false;
    await assert.rejects(prepareBrowserProverParameters(root, { fetchImpl: async () => { fetched = true; throw Error('unexpected'); } }), /integrity/);
    assert.equal(fetched, false); assert.ok((await readFile(file)).equals(bytes));
  } finally { await rm(root, { recursive: true, force: true }); }
});
