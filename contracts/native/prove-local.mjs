#!/usr/bin/env node
/** Actual circuit proofs against a loopback Midnight proof server, using synthetic
 * inputs only. No wallet, network submission or independently verified chain state.
 * Private states, proofData, preimages and provider error objects never leave memory.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtime from '@midnight-ntwrk/compact-runtime';
import { httpClientProvingProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { Contract, ledger, pureCircuits } from '../managed/native-election/contract/index.js';
import { createDemoDealer, freshBallotRandomness, nativeWitnesses, randomSecret32 } from './adapter.mjs';

const output = fileURLToPath(new URL('../../artifacts/native-proof-evidence.json', import.meta.url));
const generated = fileURLToPath(new URL('../managed/native-election/', import.meta.url));
const report = {
  schema: 'midnight-ballot-lab/local-circuit-proofs/v1',
  startedAt: new Date().toISOString(),
  execution: 'generated-contract-circuit-proofs',
  status: 'running', proofs: [], negativeChecks: [],
  networkSubmission: 'not-attempted', networkAcceptance: 'not-tested',
  independentProofVerification: 'not-tested',
};
let stage = 'prerequisites';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function save() {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
}
function setStage(name) {
  stage = name;
  console.log(JSON.stringify({ stage, status: 'started' }));
}

async function main() {
  if (process.argv.length > 2) throw new Error('No command line arguments are supported');
  const url = new URL(process.env.MIDNIGHT_LOCAL_PROOF_SERVER ?? 'http://127.0.0.1:6300');
  // Witnesses may only be sent to the loopback service explicitly used for this test.
  if (!['127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'http:'
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Loopback HTTP proof server required');
  }
  const pins = JSON.parse(await readFile(new URL('../toolchain.json', import.meta.url), 'utf8'));
  if (pins.compiler !== '0.31.1' || pins.runtime !== '0.16.0') throw new Error('Unreviewed proof toolchain');
  report.versions = { compiler: pins.compiler, runtime: pins.runtime, midnightJs: '4.1.1', node: process.version };
  report.contractSourceSha256 = digest(await readFile(new URL('../native-election.compact', import.meta.url)));
  report.generatedBindingSha256 = digest(await readFile(new URL('../managed/native-election/contract/index.js', import.meta.url)));
  const versionResponse = await fetch(new URL('/version', url), { signal: AbortSignal.timeout(10_000) });
  if (!versionResponse.ok || (await versionResponse.text()).trim() !== '8.1.3') throw new Error('Wrong proof server');
  const readyResponse = await fetch(new URL('/ready', url), { signal: AbortSignal.timeout(10_000) });
  if (!readyResponse.ok) throw new Error('Proof server unavailable');
  const ready = await readyResponse.json();
  if (ready.status !== 'ok' || ready.jobsProcessing !== 0 || ready.jobsPending !== 0) throw new Error('Proof server must be idle');
  report.versions.proofServer = '8.1.3';
  const zkConfig = new NodeZkConfigProvider(generated);
  // The supported provider controls its own fixed retry policy (3 retries on 500/503).
  const provider = httpClientProvingProvider(url.href, zkConfig, { timeout: 600_000 });
  const dealer = createDemoDealer();
  const administratorSecret = randomSecret32();
  const electionId = randomSecret32(), manifestDigest = randomSecret32(), voterSecret = randomSecret32();
  const opensAt = 2_000_000_000, closesAt = opensAt + 600;
  const coinPublicKey = '0'.repeat(64); // Local synthetic execution, never a funded wallet.
  const address = runtime.sampleContractAddress();
  const contract = new Contract(nativeWitnesses);
  const initial = contract.initialState(runtime.createConstructorContext({}, coinPublicKey),
    electionId, manifestDigest, pureCircuits.administratorIdentity(administratorSecret),
    BigInt(opensAt), BigInt(closesAt));
  let context = runtime.createCircuitContext(address, coinPublicKey, initial.currentContractState,
    {}, undefined, undefined, opensAt - 1);
  const as = privateState => { context = { ...context, currentPrivateState: privateState }; };
  const at = time => {
    context = runtime.createCircuitContext(address, coinPublicKey, context.currentQueryContext.state,
      context.currentPrivateState, undefined, undefined, time);
  };
  const state = () => ledger(context.currentQueryContext.state);

  async function prove(name, ...args) {
    setStage(name);
    const started = performance.now();
    // Preflight key presence explicitly: the provider intentionally swallows missing-key errors.
    for (const material of [await zkConfig.getProverKey(name), await zkConfig.getVerifierKey(name), await zkConfig.getZKIR(name)]) {
      if (!(material instanceof Uint8Array) || material.length === 0) throw new Error('Missing generated key material');
    }
    const result = contract.impureCircuits[name](context, ...args);
    const { input, output, publicTranscript, privateTranscriptOutputs } = result.proofData;
    const preimage = runtime.proofDataIntoSerializedPreimage(input, output, publicTranscript, privateTranscriptOutputs, name);
    try {
      if (name === 'castBallot') {
        let mismatchRejected = false;
        try { await provider.check(preimage, 'enroll'); } catch { mismatchRejected = true; }
        if (!mismatchRejected) throw new Error('Mismatched circuit accepted by proof server');
        report.negativeChecks.push({ case: 'castBallot preimage with enroll circuit material',
          outcome: 'rejected by proof server check', proofRequested: false });
        await save();
      }
      await provider.check(preimage, name);
      const proof = await provider.prove(preimage, name);
      if (!(proof instanceof Uint8Array) || proof.length === 0) throw new Error('Empty proof response');
      const evidence = { circuit: name, constraintCheck: 'passed', proofBytes: proof.length,
        proofSha256: digest(proof), elapsedMs: Math.round(performance.now() - started) };
      report.proofs.push(evidence);
      context = result.context;
      await save();
      console.log(JSON.stringify({ stage: name, status: 'proved', ...evidence }));
    } finally {
      preimage.fill(0);
    }
  }

  await save();
  as({ administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope });
  await prove('configureKeys');
  as({ administratorSecret });
  const member = pureCircuits.memberIdentity(electionId, voterSecret);
  await prove('enroll', member);
  at(opensAt + 1);
  await prove('openVoting');
  as({ voterSecret, eligibilityPath: state().members.findPathForLeaf(member),
    selection: 1n, ballotRandomness: freshBallotRandomness() });
  await prove('castBallot');
  as({});
  at(closesAt);
  await prove('closeVoting');

  setStage('reject-wrong-trustee-share');
  as({ trusteeSecretShare: dealer.trustees[1].secretShare });
  let rejected = false;
  try { contract.impureCircuits.submitDecryption(context, 1n); } catch { rejected = true; }
  if (!rejected) throw new Error('Invalid trustee share was accepted');
  report.negativeChecks.push({ case: 'wrong registered trustee share',
    outcome: 'rejected by generated circuit before proof request', proofRequested: false });
  await save();
  for (const trustee of [dealer.trustees[0], dealer.trustees[2]]) {
    as({ trusteeSecretShare: trustee.secretShare });
    await prove('submitDecryption', trustee.index);
  }
  as({});
  await prove('finalize', 1n, 3n, [0n, 1n, 0n]);
  if (state().phase !== 3n || state().accepted !== 1n) throw new Error('Unexpected final state');
  report.status = 'passed';
  report.finishedAt = new Date().toISOString();
  report.distinctCircuitsProved = new Set(report.proofs.map(item => item.circuit)).size;
  await save();
  console.log(JSON.stringify({ status: 'passed', proofs: report.proofs.length,
    distinctCircuits: report.distinctCircuitsProved, networkSubmission: 'not-attempted' }));
}

try { await main(); } catch {
  // Provider exceptions can retain HTTP requests or witness-bearing objects. Never print them.
  report.status = 'failed';
  report.failedStage = stage;
  report.finishedAt = new Date().toISOString();
  await save().catch(() => {});
  console.error(JSON.stringify({ status: 'failed', stage, detail: 'Local proof stage did not complete; private diagnostics suppressed.' }));
  process.exitCode = 1;
}
