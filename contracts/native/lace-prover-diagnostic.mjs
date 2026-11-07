/** TEST PAGE ONLY. One genuine Lace-hosted circuit proof; no funds/transactions. */
import * as runtime from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from '../managed/native-election/contract/index.js';
import { createDemoDealer, nativeWitnesses, randomSecret32 } from './adapter.mjs';
import { loadNativeProvingAssets } from './wasm-prover-assets.mjs';

const API_VERSION = '4.1.0-canary.20260819082604-3b622cb';
const connectButton = document.getElementById('lace-diagnostic-connect');
const runButton = document.getElementById('lace-diagnostic-run');
const status = document.getElementById('lace-diagnostic-status');
const output = document.getElementById('lace-diagnostic-report');
let api;
const report = { schema: 'midnight-ballot-lab/lace-fundless-contract-proof/v1', status: 'ready', stage: 'ready',
  networkId: 'preview', witnessSource: 'fresh-synthetic-browser-memory',
  fundingAttempted: false, walletDustProofsTested: false, networkSubmissionAttempted: false,
  independentProofVerification: false, walletModeApiAttestation: false, httpProofProviderConfigured: false };
function paint(stage, text) { report.stage = stage; status.textContent = text; output.textContent = JSON.stringify(report, null, 2); }
function fail() { throw new Error('The fundless Lace contract-proof diagnostic did not complete'); }
async function checkConnection() {
  const config = await api.getConfiguration(), connection = await api.getConnectionStatus();
  if (config?.networkId !== 'preview' || connection?.networkId !== 'preview' || connection?.status !== 'connected'
      || (config.proverServerUri !== undefined && config.proverServerUri !== null && config.proverServerUri !== '')) fail();
}
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  n => n.toString(16).padStart(2, '0')).join('');

connectButton.addEventListener('click', () => { void (async () => {
  connectButton.disabled = true;
  paint('connecting', 'Approve access in the fresh test wallet if requested. No transaction is requested.');
  try {
    const wallets = Object.values(window.midnight ?? {}).filter(value => value?.rdns === 'io.lace.wallet');
    if (wallets.length !== 1 || wallets[0].apiVersion !== API_VERSION) fail();
    api = await wallets[0].connect('preview'); await checkConnection();
    report.apiVersion = API_VERSION; report.status = 'connected'; runButton.disabled = false;
    paint('connected', 'Connected. Ready for one synthetic contract proof in Lace.');
  } catch {
    api = undefined; report.status = 'failed'; report.failureCategory = 'wallet-connection-failed';
    paint('connecting', 'Connection did not complete. Private diagnostics were withheld; no retry was made.');
  }
})(); });

runButton.addEventListener('click', () => { void (async () => {
  runButton.disabled = true; report.status = 'running';
  let preimage, administratorSecret, voterSecret;
  const started = performance.now();
  try {
    paint('validate-connection', 'Checking the existing Preview connection.'); await checkConnection();
    paint('load-public-material', 'Loading and checking the actual compiled public circuit material.');
    const assets = await loadNativeProvingAssets(new URL('./native-contract', location.href).href,
      location.href, __LACE_DIAGNOSTIC_MANIFEST_SHA256__);
    const material = await assets.lookupKey('openVoting');
    const key = name => { if (name !== 'openVoting') fail(); return material; };
    const provider = await api.getProvingProvider({
      getProverKey: async name => key(name).proverKey,
      getVerifierKey: async name => key(name).verifierKey,
      getZKIR: async name => key(name).ir,
    });
    if (typeof provider?.check !== 'function' || typeof provider?.prove !== 'function') fail();
    paint('prepare-real-circuit', 'Preparing a genuine generated openVoting trace with fresh synthetic inputs.');
    administratorSecret = randomSecret32(); voterSecret = randomSecret32();
    const electionId = randomSecret32(), manifestDigest = randomSecret32(), dealer = createDemoDealer();
    const contract = new Contract(nativeWitnesses), coinPublicKey = '0'.repeat(64), opensAt = 2_000_000_000;
    const address = runtime.sampleContractAddress();
    const initial = await contract.initialState(runtime.createConstructorContext({}, coinPublicKey), electionId, manifestDigest,
      pureCircuits.administratorIdentity(administratorSecret), BigInt(opensAt), BigInt(opensAt + 600), 2n);
    let currentState = initial.currentContractState;
    const contextFor = (circuitId, privateState, time) => runtime.createCircuitContext({ circuitId,
      contractAddress: address, coinPublicKeyOrZswapState: coinPublicKey, contractState: currentState, privateState, time });
    const configured = await contract.impureCircuits.configureKeys(contextFor('configureKeys',
      { administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope }, opensAt - 1));
    currentState = configured.context.callContext.currentQueryContext.state;
    const enrolled = await contract.impureCircuits.enroll(contextFor('enroll', { administratorSecret }, opensAt - 1),
      pureCircuits.memberIdentity(electionId, voterSecret));
    currentState = enrolled.context.callContext.currentQueryContext.state;
    const result = await contract.impureCircuits.openVoting(contextFor('openVoting', { administratorSecret }, opensAt + 1));
    if (ledger(result.context.callContext.currentQueryContext.state).phase !== 1n) fail();
    const trace = result.context.callProofDataTrace;
    if (trace.length !== 1 || trace[0].circuitId !== 'openVoting' || trace[0].contractAddress !== address) fail();
    const { input, output: circuitOutput, publicTranscript, privateTranscriptOutputs } = trace[0];
    preimage = runtime.proofDataIntoSerializedPreimage(input, circuitOutput, publicTranscript, privateTranscriptOutputs, 'openVoting');
    paint('check-openVoting', 'Lace is checking the genuine circuit inputs.');
    await provider.check(preimage, 'openVoting');
    paint('prove-openVoting', 'Lace is creating the synthetic openVoting proof. No fee or transaction is involved.');
    const proof = await provider.prove(preimage, 'openVoting');
    try {
      if (!(proof instanceof Uint8Array) || proof.length < 1 || proof.length > 16 * 1024 * 1024) fail();
      report.proof = { circuit: 'openVoting', constraintCheck: 'passed', bytes: proof.length,
        sha256: await sha256(proof), elapsedMs: Math.round(performance.now() - started) };
    } finally { if (proof instanceof Uint8Array) proof.fill(0); }
    report.status = 'passed'; paint('complete', 'One real Lace-hosted synthetic contract proof completed. No DUST proof or network submission was tested.');
  } catch {
    report.status = 'failed'; report.failureCategory = 'contract-proof-diagnostic-failed';
    paint(report.stage, 'The diagnostic did not complete. Private errors were withheld; no proof retry was made.');
  } finally { preimage?.fill(0); administratorSecret?.fill(0); voterSecret?.fill(0); api = undefined; }
})(); });
connectButton.disabled = false;
paint('ready', 'Ready. Use a fresh empty test wallet with on-device WASM proving selected.');
