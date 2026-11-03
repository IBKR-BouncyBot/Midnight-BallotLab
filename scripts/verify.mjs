#!/usr/bin/env node
/** Verify a public election record without loading any secret material. */
import { open } from 'node:fs/promises';
import { verifyElectionRecord } from '../src/protocol.mjs';
import { CLI_JSON_LIMIT, decodeJsonUtf8, parseStrictJson } from '../src/json.mjs';

async function readBoundedRecord(filename) {
  const file = await open(filename, 'r');
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error('The verifier requires a regular JSON file');
    const oversized = () => { throw new Error('Record exceeds the verifier CLI 64 MiB input limit'); };
    if (stats.size > CLI_JSON_LIMIT) oversized();
    const chunks = [];
    let total = 0;
    for (;;) {
      // Recheck the byte count during reading, even if the file grows after stat.
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, CLI_JSON_LIMIT - total + 1));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > CLI_JSON_LIMIT) oversized();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return decodeJsonUtf8(Buffer.concat(chunks, total), { maxBytes: CLI_JSON_LIMIT });
  } finally { await file.close(); }
}

function usage() {
  return 'Usage: node scripts/verify.mjs <public-election.json> [--manifest-hash <sha256>] [--record-hash <sha256>] [--json]';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log(usage());
    process.exitCode = args.includes('--help') ? 0 : 2;
    return;
  }
  let filename;
  let json = false;
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--manifest-hash' || arg === '--record-hash') {
      const value = args[++i];
      if (!value || !/^[a-f0-9]{64}$/.test(value)) {
        throw new Error(`${arg} requires a 64-character lowercase hexadecimal SHA-256 digest`);
      }
      options[arg === '--manifest-hash' ? 'expectedManifestHash' : 'expectedRecordHash'] = value;
    } else if (arg.startsWith('--') || filename) {
      throw new Error(`Unexpected argument: ${arg}`);
    } else {
      filename = arg;
    }
  }
  if (!filename) throw new Error(usage());
  const raw = await readBoundedRecord(filename);
  const record = parseStrictJson(raw, { maxBytes: CLI_JSON_LIMIT });
  const report = await verifyElectionRecord(record, options);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.valid ? 'PASS — public election record verifies' : 'FAIL — public election record does not verify');
    for (const check of report.checks ?? []) {
      console.log(`${check.valid ? 'PASS' : 'FAIL'}  ${check.name}`);
    }
    for (const error of report.errors ?? []) console.error(`ERROR ${error}`);
    for (const warning of report.warnings ?? []) console.log(`WARNING ${warning}`);
    if (report.valid) {
      console.log(`Ballots: ${report.ballotCount}`);
      console.log(`Tally: ${JSON.stringify(report.tally)}`);
      console.log(`Manifest fingerprint: ${report.manifestHash}`);
      console.log(`Record fingerprint: ${report.recordHash}`);
      console.log('Fingerprints use domain-separated SHA-256 over canonical protocol JSON, not raw file bytes.');
      console.log(options.expectedManifestHash || options.expectedRecordHash
        ? 'Checked against supplied expected digest(s). Their authenticity must be established separately.'
        : 'No external expected digest supplied: this checks the record internally, not its authority or completeness.');
    }
    console.log('Research verifier. Not a Midnight transaction verifier or a certification of a real election.');
  }
  process.exitCode = report.valid ? 0 : 1;
}

main().catch(error => {
  console.error(`FAIL — ${error.message}`);
  process.exitCode = 1;
});
