#!/usr/bin/env node
/** Generate a synthetic election and export only its public verification record. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  setupElection, encryptBallot, createDecryptionShare, finalizeElection,
  verifyElectionRecord, hashManifest,
} from '../src/protocol.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/demo.mjs [public-election-output.json]');
    return;
  }
  if (args.length > 1 || args[0]?.startsWith('--')) {
    throw new Error('Usage: node scripts/demo.mjs [public-election-output.json]');
  }
  const output = resolve(args[0] ?? 'artifacts/demo-election.public.json');
  const { manifest, trustees, credentials } = await setupElection({
    id: 'synthetic-election-cli-v1',
    title: 'Synthetic research election',
    candidates: ['Option A', 'Option B', 'Option C'],
    voterCount: 5,
    maxBallots: 100,
  });
  const choices = [0, 1, 2, 2, 0];
  const ballots = [];
  for (let i = 0; i < choices.length; i++) {
    ballots.push(await encryptBallot(manifest, choices[i], credentials[i]));
  }
  const shares = await Promise.all([trustees[0], trustees[2]].map(t =>
    createDecryptionShare(manifest, ballots, t)));
  const record = await finalizeElection(manifest, ballots, shares);
  const report = await verifyElectionRecord(record, {
    expectedManifestHash: await hashManifest(manifest),
  });
  if (!report.valid) throw new Error(`Demo verification failed: ${(report.errors ?? []).join('; ')}`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o644 });
  console.log(`Public record: ${output}`);
  console.log(`Verified tally: ${JSON.stringify(report.tally)}`);
  console.log(`Manifest fingerprint: ${report.manifestHash}`);
  console.log(`Record fingerprint: ${report.recordHash}`);
  console.log('Fingerprints use domain-separated SHA-256 over canonical protocol JSON, not raw file bytes.');
  console.log('Synthetic voter and trustee secrets were used only in memory and were not exported.');
  console.log('Local research demonstration; no Midnight transaction was submitted.');
}

main().catch(error => {
  console.error(`Demo failed: ${error.message}`);
  process.exitCode = 1;
});
