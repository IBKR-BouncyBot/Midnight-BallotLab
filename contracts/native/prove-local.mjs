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
  if (pins.compiler !== '0.36.0' || pins.runtime !== '0.21.0' || pins.ledger !== 9) throw new Error('Unreviewed proof toolchain');
  report.versions = { compiler: pins.compiler, runtime: pins.runtime, midnightJs: '5.0.0', ledger: '1.0.0', node: process.version };
  report.contractSourceSha256 = digest(await readFile(new URL('../native-election.compact', import.meta.url)));
  report.generatedBindingSha256 = digest(await readFile(new URL('../managed/native-election/contract/index.js', import.meta.url)));
  const versionResponse = await fetch(new URL('/version', url), { signal: AbortSignal.timeout(10_000) });
  if (!versionResponse.ok || (await versionResponse.text()).trim() !== '9.0.0') throw new Error('Wrong proof server');
  const readyResponse = await fetch(new URL('/ready', url), { signal: AbortSignal.timeout(10_000) });
  if (!readyResponse.ok) throw new Error('Proof server unavailable');
  const ready = await readyResponse.json();
  if (ready.status !== 'ok' || ready.jobsProcessing !== 0 || ready.jobsPending !== 0) throw new Error('Proof server must be idle');
  report.versions.proofServer = '9.0.0';
  const zkConfig = new NodeZkConfigProvider(generated, { verify: 'require' });
  // The supported provider controls its own fixed retry policy (3 retries on 500/503).
  const provider = httpClientProvingProvider(url.href, zkConfig, { timeout: 600_000 });
  const dealer = createDemoDealer();
  const administratorSecret = randomSecret32();
  const electionId = randomSecret32(), manifestDigest = randomSecret32(), voterSecret = randomSecret32();
  const opensAt = 2_000_000_000, closesAt = opensAt + 600;
  const coinPublicKey = '0'.repeat(64); // Local synthetic execution, never a funded wallet.
  const address = runtime.sampleContractAddress();
  const contract = new Contract(nativeWitnesses);
  const initial = await contract.initialState(runtime.createConstructorContext({}, coinPublicKey),
    electionId, manifestDigest, pureCircuits.administratorIdentity(administratorSecret),
    BigInt(opensAt), BigInt(closesAt), 5n);
  report.candidateCount = 5;
  let currentState = initial.currentContractState, currentPrivateState = {}, currentTime = opensAt - 1;
  const contextFor = circuitId => runtime.createCircuitContext({ circuitId, contractAddress: address,
    coinPublicKeyOrZswapState: coinPublicKey, contractState: currentState,
    privateState: currentPrivateState, time: currentTime });
  const as = privateState => { currentPrivateState = privateState; };
  const at = time => { currentTime = time; };
  const state = () => ledger(currentState.data ?? currentState);

  async function prove(name, ...args) {
    setStage(name);
    const started = performance.now();
    // Require the compiler manifest and material before invoking the HTTP provider.
    for (const material of [await zkConfig.getProverKey(name), await zkConfig.getVerifierKey(name), await zkConfig.getZKIR(name)]) {
      if (!(material instanceof Uint8Array) || material.length === 0) throw new Error('Missing generated key material');
    }
    const result = await contract.impureCircuits[name](contextFor(name), ...args);
    const trace = result.context.callProofDataTrace;
    if (trace.length !== 1 || trace[0].circuitId !== name || trace[0].contractAddress !== address) {
      throw new Error('Unexpected native proof trace');
    }
    const { input, output, publicTranscript, privateTranscriptOutputs } = trace[0];
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
      currentState = result.context.callContext.currentQueryContext.state;
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
    selection: 4n, ballotRandomness: freshBallotRandomness() });
  await prove('castBallot');
  as({});
  at(closesAt);
  await prove('closeVoting');

  setStage('reject-wrong-trustee-share');
  as({ trusteeSecretShare: dealer.trustees[1].secretShare });
  let rejected = false;
  try { await contract.impureCircuits.submitDecryption(contextFor('submitDecryption'), 1n); } catch { rejected = true; }
  if (!rejected) throw new Error('Invalid trustee share was accepted');
  report.negativeChecks.push({ case: 'wrong registered trustee share',
    outcome: 'rejected by generated circuit before proof request', proofRequested: false });
  await save();
  for (const trustee of [dealer.trustees[0], dealer.trustees[2]]) {
    as({ trusteeSecretShare: trustee.secretShare });
    await prove('submitDecryption', trustee.index);
  }
  as({});
  await prove('finalize', 1n, 3n, [0n, 0n, 0n, 0n, 1n]);
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
