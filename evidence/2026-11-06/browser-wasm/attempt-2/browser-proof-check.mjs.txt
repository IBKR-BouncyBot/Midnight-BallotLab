/** TEST ENTRY ONLY. Synthetic witnesses are created in this page's memory.
 * Bundled separately into ignored artifacts; never included in the frontend.
 */
import * as runtime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../managed/native-election/contract/index.js';
import { createDemoDealer, freshBallotRandomness, nativeWitnesses, randomSecret32 } from './adapter.mjs';
import { createNativeWasmProofProvider, nativeWasmProofErrorMessage, nativeWasmProofErrorCode } from './browser-wasm-proof.mjs';

const status = document.getElementById('proof-state');
const output = document.getElementById('proof-report');
const runButton = document.getElementById('run-browser-proofs');
const cancelButton = document.getElementById('cancel-browser-proofs');
const downloadButton = document.getElementById('download-proof-report');
let provider, report, cancelled = false;
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  n => n.toString(16).padStart(2, '0')).join('');
const paint = () => { output.textContent = JSON.stringify(report, null, 2); };
cancelButton.addEventListener('click', () => { cancelled = true; provider?.close(); });
downloadButton.addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'native-browser-proof-evidence.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

async function run() {
  runButton.disabled = true; cancelButton.disabled = false; downloadButton.disabled = true;
  cancelled = false;
  report = { schema: 'midnight-ballot-lab/browser-circuit-proofs/v1', startedAt: new Date().toISOString(),
    execution: 'generated-contract-proofs-in-dedicated-browser-worker', status: 'running',
    versions: { compiler: '0.31.1', runtime: '0.16.0', midnightJs: '4.1.1', zkir: '2.1.1' },
    candidateCount: 5, proofs: [], negativeChecks: [],
    witnessSource: 'fresh-synthetic-browser-memory', httpProofProviderConfigured: false,
    workerAssetPolicy: 'same-origin-public-GET-with-size-and-SHA256',
    mainPageConnectCsp: "connect-src 'self'",
    walletExecution: 'not-attempted', networkSubmission: 'not-attempted', networkAcceptance: 'not-tested',
    independentProofVerification: 'not-tested',
  };
  paint();
  let currentStage = 'initialize-worker', castPreimage;
  try {
    provider = await createNativeWasmProofProvider({ compiledAssetsUrl: new URL('./native-contract', location.href).href,
      onProofProgress: ({ phase, circuit }) => { status.textContent = `${currentStage}: ${phase}${circuit ? ` (${circuit})` : ''}`; },
    });
    const proving = provider.provingProvider;
    const dealer = createDemoDealer();
    const administratorSecret = randomSecret32(), electionId = randomSecret32();
    const manifestDigest = randomSecret32(), voterSecret = randomSecret32();
    // The synthetic circuit fixture intentionally controls its local context
    // timestamps. These are proof tests, not wall-clock/network transactions.
    const opensAt = 2_000_000_000, closesAt = opensAt + 600;
    const coinPublicKey = '0'.repeat(64), address = runtime.sampleContractAddress();
    const contract = new Contract(nativeWitnesses);
    const initial = contract.initialState(runtime.createConstructorContext({}, coinPublicKey),
      electionId, manifestDigest, pureCircuits.administratorIdentity(administratorSecret), BigInt(opensAt), BigInt(closesAt), 5n);
    let context = runtime.createCircuitContext(address, coinPublicKey, initial.currentContractState, {}, undefined, undefined, opensAt - 1);
    const as = currentPrivateState => { context = { ...context, currentPrivateState }; };
    const at = time => { context = runtime.createCircuitContext(address, coinPublicKey,
      context.currentQueryContext.state, context.currentPrivateState, undefined, undefined, time); };
    const state = () => ledger(context.currentQueryContext.state);
    async function prove(name, ...args) {
      if (cancelled) throw new Error('Cancelled');
      currentStage = name;
      report.currentStage = name; paint();
      const started = performance.now();
      const result = contract.impureCircuits[name](context, ...args);
      const { input, output: circuitOutput, publicTranscript, privateTranscriptOutputs } = result.proofData;
      const preimage = runtime.proofDataIntoSerializedPreimage(input, circuitOutput, publicTranscript, privateTranscriptOutputs, name);
      try {
        await proving.check(preimage, name);
        const proof = await proving.prove(preimage, name);
        if (!(proof instanceof Uint8Array) || proof.length === 0) throw new Error('Empty proof');
        report.proofs.push({ circuit: name, constraintCheck: 'passed', proofBytes: proof.length,
          proofSha256: await sha256(proof), elapsedMs: Math.round(performance.now() - started) });
        if (name === 'castBallot') castPreimage = preimage.slice();
        context = result.context; paint();
      } finally { preimage.fill(0); }
    }
    as({ administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope });
    await prove('configureKeys');
    as({ administratorSecret });
    const member = pureCircuits.memberIdentity(electionId, voterSecret);
    await prove('enroll', member);
    at(opensAt + 1); await prove('openVoting');
    as({ voterSecret, eligibilityPath: state().members.findPathForLeaf(member), selection: 4n,
      ballotRandomness: freshBallotRandomness() });
    await prove('castBallot');
    as({}); at(closesAt); await prove('closeVoting');
    currentStage = 'reject-wrong-trustee-share';
    as({ trusteeSecretShare: dealer.trustees[1].secretShare });
    let rejected = false;
    try { contract.impureCircuits.submitDecryption(context, 1n); } catch { rejected = true; }
    if (!rejected) throw new Error('Wrong share accepted');
    report.negativeChecks.push({ case: 'wrong registered trustee share', outcome: 'rejected by generated circuit', proofRequested: false });
    for (const trustee of [dealer.trustees[0], dealer.trustees[2]]) {
      as({ trusteeSecretShare: trustee.secretShare }); await prove('submitDecryption', trustee.index);
    }
    as({}); await prove('finalize', 1n, 3n, [0n, 0n, 0n, 0n, 1n]);
    if (state().phase !== 3n || state().accepted !== 1n) throw new Error('Unexpected final state');
    currentStage = 'reject-mismatched-circuit';
    rejected = false;
    try { await proving.check(castPreimage, 'enroll'); }
    catch (error) {
      if (!cancelled && nativeWasmProofErrorCode(error) === 'PROOF_FAILED') rejected = true;
      else throw error;
    }
    if (!rejected) throw new Error('Wrong circuit accepted');
    report.negativeChecks.push({ case: 'castBallot preimage with enroll key location', outcome: 'rejected by local worker check', proofRequested: false });
    report.status = 'passed'; report.distinctCircuitsProved = new Set(report.proofs.map(item => item.circuit)).size;
    report.phase = 3; report.acceptedBallots = 1;
    status.textContent = 'Passed: eight real browser proofs across all seven native circuits. No wallet or transaction was used.';
  } catch (error) {
    report.status = cancelled ? 'cancelled' : 'failed'; report.failedStage = currentStage;
    report.safeDiagnostic = nativeWasmProofErrorMessage(error) ?? 'The browser proof check did not complete; private diagnostics were withheld.';
    status.textContent = `${report.status}: ${currentStage}. ${report.safeDiagnostic}`;
  } finally {
    castPreimage?.fill(0); provider?.close(); provider = undefined;
    report.finishedAt = new Date().toISOString(); delete report.currentStage; paint();
    runButton.disabled = false; cancelButton.disabled = true; downloadButton.disabled = false;
  }
}
runButton.addEventListener('click', () => { void run(); });
runButton.disabled = false;
status.textContent = 'Ready. This test creates fresh synthetic inputs in browser memory and proves all seven native circuits.';
