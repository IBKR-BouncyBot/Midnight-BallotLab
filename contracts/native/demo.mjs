#!/usr/bin/env node
/** Runs the REAL generated Compact code locally. Never submits a transaction. */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoDealer, freshBallotRandomness, randomSecret32 } from './adapter.mjs';
import { createNativeEmulator, nativePublicSnapshot, recoverNativeTally, loadNativeModules } from './harness.mjs';
import { nativeManifestDigest } from './verify-public.mjs';

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node native/demo.mjs [public-snapshot.json]\nRequires npm install and npm run compile:native in contracts/. Executes generated Compact logic only: no proof generation or Midnight network submission.');
    return;
  }
  if (process.argv.length > 3) throw new Error('Supply at most one public snapshot output path');
  // Fail before generating any synthetic secrets if native prerequisites are missing.
  await loadNativeModules();
  const dealer = createDemoDealer();
  const administratorSecret = randomSecret32(), electionId = randomSecret32();
  const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const opensAt = 2_000_000_000, closesAt = opensAt + 600;
  const manifest = {
    schema: 'midnight-ballot-lab/native-demo-manifest/v2', execution: 'emulator',
    electionId: hex(electionId), title: 'Native Compact synthetic election',
    candidates: ['Option A', 'Option B', 'Option C'], threshold: 2, capacity: 1024,
    syntheticVoters: 5, timingMode: 'manual', durationSeconds: 600, opensAt, closesAt,
  };
  // This manifest digest is an external configuration commitment. It is not a
  // substitute for Compact's typed native identity/nullifier/receipt hashes.
  const manifestDigest = await nativeManifestDigest(manifest);
  const emulator = await createNativeEmulator({ electionId, manifestDigest, administratorSecret,
    setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope, opensAt, closesAt, candidateCount: manifest.candidates.length });
  const voters = Array.from({ length: 5 }, () => randomSecret32());
  for (const secret of voters) await emulator.call('enroll', emulator.pureCircuits.memberIdentity(electionId, secret));
  emulator.setTime(opensAt + 1);
  await emulator.call('openVoting');
  const choices = [0n, 1n, 2n, 0n, 2n]; // Public synthetic test scenario, never real voter input.
  for (const [index, voterSecret] of voters.entries()) {
    const leaf = emulator.pureCircuits.memberIdentity(electionId, voterSecret);
    const eligibilityPath = emulator.readLedger().members.findPathForLeaf(leaf);
    emulator.setPrivateState({ voterSecret, eligibilityPath, selection: choices[index], ballotRandomness: freshBallotRandomness() });
    await emulator.call('castBallot');
  }
  emulator.setPrivateState({});
  emulator.setTime(closesAt);
  await emulator.call('closeVoting');
  // The less trivial 1+3 pair uses the contract's scaled equation (factor two).
  for (const trustee of [dealer.trustees[0], dealer.trustees[2]]) {
    emulator.setPrivateState({ trusteeSecretShare: trustee.secretShare });
    await emulator.call('submitDecryption', trustee.index);
  }
  emulator.setPrivateState({});
  const totals = recoverNativeTally(emulator, 1n, 3n);
  if (totals.map(String).join(',') !== '2,1,2,0,0') throw new Error('Native emulator produced an unexpected synthetic tally');
  await emulator.call('finalize', 1n, 3n, totals);
  const snapshot = { ...nativePublicSnapshot(emulator), manifest };
  const defaultOutput = fileURLToPath(new URL('../../artifacts/native-emulator-public.json', import.meta.url));
  const output = process.argv[2] ? resolve(process.argv[2]) : defaultOutput;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify({ execution: 'generated-contract-emulator', ballots: snapshot.accepted,
    candidateCount: snapshot.candidateCount, tally: snapshot.finalizedTotals, publicSnapshot: basename(output),
    nativeProofGenerated: false, networkTransactionSubmitted: false,
    note: 'All synthetic roles run in one process. Public snapshot is not a proof or authenticated chain record.' }, null, 2));
}

main().catch(error => {
  // A runtime/prover error can contain private inputs. Retain only a safe
  // failure marker; the generated test suite supplies constraint diagnostics.
  console.error('Native demo did not complete. Check installed dependencies, generated artifacts and native test results.');
  process.exitCode = 1;
});
