import { connectNativeBrowserProviders, nativeConnectionErrorMessage, nativeStoragePasswordMessage, validateNativeStoragePassword } from '../contracts/native/browser-providers.mjs';
import { findNativeWallets, nativeNetworkErrorMessage } from '../contracts/native/browser-config.mjs';
import { PREVIEW_PUBLIC_SERVICES, previewBrowserConfiguration, checkPreviewPublicServices, formatPreviewServiceError } from '../contracts/native/public-testnet.mjs';
import { createNativeSdkClient } from '../contracts/native/sdk-client.mjs';
import { createDemoDealer, randomSecret32, requireBytes32, requireScalar } from '../contracts/native/adapter.mjs';
import { projectNativePublicLedger } from '../contracts/native/record.mjs';
import * as Native from '../contracts/managed/native-election/contract/index.js';
import { encodeNetworkReceipt, decodeNetworkReceipt, networkReceiptNextSteps } from './network-receipt.mjs';
import { qrSvg } from './qr.mjs';
import { normalizePrivateKey, privateKeyText, readPrivateKeyFile } from './private-key.mjs';
import { encodeElectionJoinFile, readElectionJoinFile } from './election-join.mjs';
import { encodeTrusteeKeyFile, readTrusteeKeyFile, assertTrusteeKeyMatches } from './trustee-key.mjs';
import { describeNetworkElectionTiming, formatNetworkTimingDate } from './network-timing.mjs';
import { describeNetworkVoting } from './network-voting.mjs';

const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const bytes = value => {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new TypeError('Expected 32 hexadecimal bytes');
  return requireBytes32(Uint8Array.from(value.match(/../g), item => parseInt(item, 16)));
};
const scalar = value => {
  if (!/^[1-9][0-9]{0,76}$/.test(value)) throw new TypeError('Expected canonical decimal scalar');
  return requireScalar(BigInt(value));
};
const privateKeyBytes = value => bytes(normalizePrivateKey(value));
const stages = Object.freeze({
  'wallet-connected': 'Wallet connected. No transaction submitted.',
  'proving-provider-started': 'Preparing the transaction and any required proofs…',
  'proving-provider-completed': 'Transaction preparation finished. The network has not accepted it yet.',
  'wallet-approval-requested': 'Check your wallet to approve the transaction and its fee.',
  'wallet-balanced': 'Your wallet signed the transaction.',
  'submission-returned': 'Transaction submitted. Waiting for confirmation from your indexer…',
});
const connectionStages = Object.freeze({
  'connection-settings': 'Checking this app’s connection settings…',
  'connection-permission': 'Waiting for Lace permission. Open Lace and approve this site’s connection request.',
  'connection-account': 'Reading the Midnight account selected in Lace…',
  'connection-network': 'Checking that Lace and this app use the same test network…',
  'connection-local-prover': 'Checking the local proof-server setting reported by Lace…',
  'connection-proving-provider': 'Asking Lace to initialize its proving connection…',
  'connection-storage': 'Preparing encrypted storage for this app…',
  'connection-providers': 'Preparing the network tools for this connection…',
});

function saveJsonText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function savePublicJson(filename, value) {
  saveJsonText(filename, JSON.stringify(value, null, 2) + '\n');
}

export async function initNetworkApplication() {
  if (typeof Native.Contract !== 'function' || typeof Native.pureCircuits?.receiptDigest !== 'function') throw new Error('Generated native contract missing');
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error('Secure browser cryptography required');
  const $ = id => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Incomplete network markup');
    return element;
  };
  const controls = [...document.querySelectorAll('[data-network-control]')];
  let wallets = [], session = null, client = null, state = null, busy = false;
  let dealer = null, latestReceipt = null, manifest = null;
  let connectionFeedback = false;
  let setupMode = 'create';
  let lastStateReadAt = null;
  const setTimingText = (id, text) => {
    const element = $(id);
    if (element.textContent !== text) element.textContent = text;
  };
  const setTimingDate = (id, value) => {
    const element = $(id); setTimingText(id, value.text);
    if (element.tagName !== 'TIME') return;
    if (value.dateTime === null) { if (element.hasAttribute('datetime')) element.removeAttribute('datetime'); }
    else if (element.getAttribute('datetime') !== value.dateTime) element.setAttribute('datetime', value.dateTime);
  };
  const renderElectionTiming = () => {
    const timing = describeNetworkElectionTiming(lastStateReadAt === null ? null : state, Date.now());
    setTimingText('network-election-phase', timing.phase);
    setTimingText('network-election-countdown', timing.countdown);
    setTimingDate('network-election-opens', timing.opens);
    setTimingDate('network-election-closes', timing.closes);
    setTimingText('network-election-updated', lastStateReadAt === null ? 'Election record not loaded yet.' : `Last refreshed: ${formatNetworkTimingDate(lastStateReadAt).text}`);
    setTimingText('network-election-timing-note', timing.note);
  };
  const selectedValue = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? '';
  const clearSelection = name => document.querySelectorAll(`input[name="${name}"]`).forEach(input => { input.checked = false; });
  const keyRoles = ['admin', 'voter'];
  const keyName = role => role === 'admin' ? 'Administrator' : 'Voter';
  const setKeyVisibility = (role, visible) => {
    $(`network-${role}`).type = visible ? 'text' : 'password';
    $(`network-show-${role}`).textContent = visible ? 'Hide key' : 'Show key';
    $(`network-show-${role}`).setAttribute('aria-pressed', String(visible));
  };
  // Fresh initialization discards any browser-restored/autofilled value once.
  // Later mode changes preserve the user's key; manual entry is explicit.
  $('network-admin').value = '';
  $('network-admin').readOnly = true;
  setKeyVisibility('admin', false);
  const lockAdministratorField = () => {
    $('network-admin').readOnly = true;
    $('network-admin').placeholder = 'Click Generate administrator key';
  };
  let voterDownloadCount = 0;
  const voterDownloadCounterKey = 'midnight-ballot-lab/voter-key-download-count';
  const nextVoterFilename = async () => {
    voterDownloadCount++;
    const fallback = () => `midnight-voter-key-${Date.now()}-${String(voterDownloadCount).padStart(6, '0')}.private.txt`;
    const allocate = () => {
      try {
        const previous = localStorage.getItem(voterDownloadCounterKey);
        if (previous !== null && !/^(0|[1-9][0-9]{0,15})$/.test(previous)) return fallback();
        const count = previous === null ? 0 : Number(previous);
        if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) return fallback();
        const next = count + 1;
        // Only a download counter is persisted. No key, voter identity or
        // key-to-filename mapping enters storage, logs, or public exports.
        localStorage.setItem(voterDownloadCounterKey, String(next));
        if (localStorage.getItem(voterDownloadCounterKey) !== String(next)) return fallback();
        return `midnight-voter-key-${String(next).padStart(6, '0')}.private.txt`;
      } catch { return fallback(); }
    };
    try {
      return navigator.locks?.request ? await navigator.locks.request(voterDownloadCounterKey, allocate) : allocate();
    } catch { return fallback(); }
  };
  const hasValidKey = role => {
    try { normalizePrivateKey($(`network-${role}`).value); return true; } catch { return false; }
  };
  const clearReceiptIdResult = () => { $('network-receipt-id-result').textContent = ''; };
  const clearReceiptDisplay = () => {
    $('network-receipt-panel').hidden = true;
    $('network-receipt-code').textContent = '';
    $('network-receipt-id-display').textContent = '';
    $('network-receipt-qr').replaceChildren();
    $('network-next-steps-text').textContent = ''; $('network-next-steps').hidden = true;
    clearReceiptIdResult();
  };
  const showReceipt = () => {
    const code = encodeNetworkReceipt(latestReceipt);
    $('network-receipt-code').textContent = code;
    $('network-receipt-id-display').textContent = latestReceipt.receipt;
    $('network-receipt-qr').innerHTML = qrSvg(code);
    $('network-receipt-panel').hidden = false;
    $('network-next-steps-text').textContent = networkReceiptNextSteps(state);
    $('network-next-steps').hidden = false;
  };
  const resetSessionDisplay = () => {
    lastStateReadAt = null; renderElectionTiming();
    ['network-choice', 'network-trustee', 'network-pair'].forEach(clearSelection);
    $('network-share').value = '';
    for (let index = 0; index < 5; index++) {
      $(`network-choice-label-${index}`).textContent = `Choice ${index}`;
      $(`network-choice-${index}`).closest('label').hidden = index >= 3;
    }
    clearReceiptDisplay();
    $('network-receipt-input').value = '';
    $('network-receipt-id').value = '';
    $('network-public-state').textContent = 'No contract connected';
    for (const kind of ['election', 'trustee']) {
      $(`network-import-${kind}`).value = '';
      $(`network-${kind}-file-status`).textContent = '';
    }
    $('network-trustee-download-status').textContent = 'Generate and register the trustee shares before downloading them. Save all three before leaving this setup session.';
  };
  const event = message => {
    const item = document.createElement('p'); item.textContent = message; $('network-events').prepend(item);
    while ($('network-events').children.length > 30) $('network-events').lastElementChild.remove();
  };
  const status = message => {
    $('network-status').textContent = message; $('network-status').hidden = false;
    if (connectionFeedback) {
      $('network-connection-status').textContent = message;
      $('network-connection-status').scrollIntoView({ block: 'nearest' });
    }
  };
  const hasConfiguredElection = () => Boolean(session && client?.contractAddress && client.configurationDigest
    && state?.keysConfigured === true && hex(state.configurationDigest) === hex(client.configurationDigest));
  const electionDetails = () => {
    if (!hasConfiguredElection()) throw new Error('A configured election is required');
    // Read the pinned SDK context, never editable form fields or zero setup placeholders.
    return { networkId: session.networkId, contractAddress: client.contractAddress,
      configurationDigest: hex(client.configurationDigest) };
  };
  const refreshVotingControls = () => {
    const voterKeyValid = hasValidKey('voter');
    let voterRegistered = null, voterSpent = null;
    if (!busy && voterKeyValid && hasConfiguredElection()) {
      try {
        // These identities stay private to the current UI. Only booleans reach
        // the readiness display; no key, identity or nullifier is logged/exported.
        const secret = privateKeyBytes($('network-voter').value);
        const member = Native.pureCircuits.memberIdentity(state.electionId, secret);
        const nullifier = Native.pureCircuits.voterNullifier(state.electionId, secret);
        voterRegistered = state.enrolled.member(member);
        voterSpent = state.spent.member(nullifier);
      } catch { voterRegistered = null; voterSpent = null; }
    }
    const readiness = describeNetworkVoting({
      walletConnected: Boolean(session), contractConnected: Boolean(client?.contractAddress),
      configurationVerified: hasConfiguredElection(), state, busy,
      pendingReceipt: Boolean(client?.pendingBallotReceipt), voterKeyValid, voterRegistered, voterSpent,
      selectedChoice: selectedValue('network-choice'), nowMilliseconds: Date.now(),
    });
    $('network-selection').disabled = !readiness.canChoose;
    $('network-cast').disabled = !readiness.canCast;
    setTimingText('network-voting-readiness', readiness.message);
    $('network-voting-next').hidden = !readiness.actionHref;
    if (readiness.actionHref) {
      $('network-voting-next').setAttribute('href', readiness.actionHref);
      setTimingText('network-voting-next', readiness.actionLabel);
    }
  };
  const refreshControls = () => {
    controls.forEach(control => { control.disabled = busy; });
    const requireClient = ['network-join', 'network-deploy'];
    const requireContract = ['network-read', 'network-refresh-voting', 'network-configure', 'network-export'];
    const requireConfigured = ['network-enroll', 'network-open', 'network-cast', 'network-close', 'network-submit-share', 'network-finalize', 'network-check-receipt', 'network-check-receipt-id'];
    for (const id of requireClient) $(id).disabled = busy || !client || Boolean(client.contractAddress);
    for (const id of requireContract) $(id).disabled = busy || !client?.contractAddress;
    for (const id of requireConfigured) $(id).disabled = busy || !client?.configurationDigest;
    refreshVotingControls();
    $('network-trustee').disabled = busy || !client?.configurationDigest;
    $('network-pair').disabled = busy || !client?.configurationDigest;
    $('network-submit-share').disabled = busy || !client?.configurationDigest || !/^[123]$/.test(selectedValue('network-trustee'));
    $('network-finalize').disabled = busy || !client?.configurationDigest || !['1,2', '1,3', '2,3'].includes(selectedValue('network-pair'));
    $('network-configure').disabled = busy || !client?.contractAddress || state?.keysConfigured === true;
    $('network-generate-dealer').disabled = busy || state?.keysConfigured === true || Boolean(client?.configurationDigest);
    $('network-use-share').disabled = busy || !dealer || !/^[123]$/.test(selectedValue('network-trustee'));
    $('network-import-election').disabled = busy || Boolean(client?.contractAddress);
    $('network-download-election').disabled = busy || !hasConfiguredElection();
    $('network-import-trustee').disabled = busy || !hasConfiguredElection();
    for (let index = 1; index <= 3; index++) {
      $(`network-download-trustee-${index}`).disabled = busy || !dealer || !hasConfiguredElection();
    }
    $('network-election-download-note').textContent = hasConfiguredElection()
      ? 'Save this public file to join again later, or share it with voters and trustees. It contains the network, address and fingerprint, without private keys.'
      : client?.contractAddress
        ? 'Register the trustee keys to complete the election fingerprint, then download this file before leaving the setup session. If registration already finished, refresh the election record.'
        : 'Connect a wallet, then create or join an election. The download becomes available once its trustee keys are registered.';
    $('network-save-receipt').disabled = busy || !latestReceipt;
    $('network-copy-receipt-id').disabled = busy || !latestReceipt;
    $('network-recover-receipt').disabled = busy || !client?.pendingBallotReceipt;
    $('network-disconnect').disabled = busy || !session;
    $('network-connect').disabled = busy || Boolean(session);
    $('network-password').readOnly = Boolean(session);
    // A connected client stays bound to one wallet/network. Do not let the
    // displayed selection change while that session can still transact.
    for (const id of ['network-id', 'network-wallet', 'network-refresh-wallets']) $(id).disabled = busy || Boolean(session);
    for (const id of ['network-indexer', 'network-indexer-ws']) $(id).readOnly = Boolean(session) || $('network-id').value === 'preview';
    $('network-check-services').disabled = busy || $('network-id').value !== 'preview';
    for (const role of keyRoles) {
      $(`network-show-${role}`).disabled = busy || !$(`network-${role}`).value;
      $(`network-download-${role}`).disabled = busy || !hasValidKey(role);
    }
    for (const mode of ['create', 'join']) {
      const button = $(`network-mode-${mode}`);
      button.disabled = busy || Boolean(client?.contractAddress);
      button.setAttribute('aria-pressed', String(setupMode === mode));
      button.classList.toggle('primary', setupMode === mode);
      button.classList.toggle('secondary', setupMode !== mode);
    }
    $('network-create-panel').hidden = setupMode !== 'create';
    $('network-join-panel').hidden = setupMode !== 'join' && !client?.contractAddress;
    $('network-join').hidden = setupMode !== 'join';
    $('network-join').disabled = busy || !client || Boolean(client.contractAddress) || setupMode !== 'join';
    $('network-deploy').disabled = busy || !client || Boolean(client.contractAddress) || setupMode !== 'create';
    for (const id of ['network-address', 'network-digest']) $(id).readOnly = setupMode !== 'join' || Boolean(client?.contractAddress);
    $('network-setup-note').textContent = client?.contractAddress
      ? 'This session is connected to an election. Disconnect before creating or joining another election.'
      : setupMode === 'create' ? 'Create a new test election with your own choices and voting schedule.'
        : 'Join an existing election using its contract address and fingerprint. You do not need to create new election keys.';
    $('network-identity-note').textContent = client?.contractAddress
      ? 'Download these public election details so you can join again later. The fingerprint appears after trustee keys are registered. These details identify the election; they do not independently verify its history.'
      : 'Get the contract address and fingerprint from a source you trust. The app checks that the contract’s keys and settings match, but cannot prove that its initial setup or history was honest.';
    $('network-admin-help').textContent = client?.contractAddress
      ? 'Only the election administrator needs this key. Keep the key used to create this election; do not replace it with a newly generated key.'
      : setupMode === 'create'
        ? 'For a new election, click Generate administrator key, then download it. To reuse a saved key, choose Use an existing key or load its file.'
        : 'Joining as a voter does not require an administrator key. The administrator should use the existing key or load its saved file.';
  };
  const run = async (operation, { connection = false } = {}) => {
    if (busy) return;
    connectionFeedback = connection;
    busy = true; refreshControls(); status('Working… Keep this page open until the action finishes.');
    try { await operation(); }
    catch (error) { status(client?.pendingBallotReceipt
      ? 'A vote attempt has an unresolved outcome. Use “Check pending vote” and check your wallet before trying again or closing this page. This message does not confirm that a transaction was submitted.'
      : formatPreviewServiceError(error) ?? nativeStoragePasswordMessage(error) ?? nativeConnectionErrorMessage(error) ?? nativeNetworkErrorMessage(error)); }
    finally { busy = false; connectionFeedback = false; refreshControls(); }
  };
  const click = (id, operation) => $(id).addEventListener('click', () => void run(operation));
  const confirmed = (label, result) => {
    if (typeof result?.txId !== 'string') throw new Error('Missing SDK transaction identifier');
    event(`${label}: configured indexer confirmed ${result.txId} at block ${result.blockHeight}.`);
    status(`${label}: your indexer reports confirmation. This app has not independently verified the blockchain.`);
  };
  const refreshState = async () => {
    const nextState = client.configurationDigest ? await client.refreshConfiguration() : await client.readPublicLedger();
    const candidateCount = Number(nextState.candidateCount);
    if (!Number.isInteger(candidateCount) || candidateCount < 2 || candidateCount > 5) throw new Error('Unsupported candidate count');
    state = nextState; lastStateReadAt = Date.now(); renderElectionTiming();
    for (let index = 0; index < 5; index++) $(`network-choice-${index}`).closest('label').hidden = index >= candidateCount;
    $('network-address').value = client.contractAddress;
    $('network-digest').value = client.configurationDigest ? hex(client.configurationDigest) : '';
    $('network-public-state').textContent = JSON.stringify({ network: session.networkId,
      contractAddress: client.contractAddress, keysConfigured: state.keysConfigured,
      configurationDigest: hex(state.configurationDigest), candidateCount, phase: Number(state.phase), accepted: Number(state.accepted),
      opensAt: String(state.opensAt), closesAt: String(state.closesAt), totals: state.finalizedTotals.map(Number),
      source: 'configured-indexer', independentlyVerified: false }, null, 2);
    if (latestReceipt) showReceipt();
  };
  const refreshWallets = () => {
    wallets = findNativeWallets(); $('network-wallet').replaceChildren();
    for (const item of wallets) {
      const option = document.createElement('option'); option.value = item.id;
      option.textContent = `${item.name} (${item.rdns}, API ${item.apiVersion})`; $('network-wallet').append(option);
    }
    const duplicates = new Set(wallets.map(item => item.rdns)).size !== wallets.length;
    $('network-wallet-note').textContent = !wallets.length ? 'No compatible wallet detected. Open this page in the browser where Lace is installed, enable Midnight in Lace, then reload this page and refresh the wallet list.'
      : duplicates ? 'More than one extension uses this wallet name. Check your installed extensions before choosing.'
        : 'Choose your wallet. This page cannot verify who published a browser extension.';
  };
  const selectEnvironment = () => {
    if (session || busy) return;
    clearReceiptIdResult();
    $('network-election-file-status').textContent = '';
    const network = $('network-id').value;
    if (network === 'preview') {
      $('network-indexer').value = PREVIEW_PUBLIC_SERVICES.indexerUri;
      $('network-indexer-ws').value = PREVIEW_PUBLIC_SERVICES.indexerWsUri;
      $('network-environment-note').textContent = 'Preview’s public indexer is selected automatically. No service API key is needed. In Lace, choose Settings → Network → Testnet → Midnight: Preview, then confirm.';
    } else if (network === 'undeployed') {
      $('network-indexer').value = 'http://127.0.0.1:8088/api/v4/graphql';
      $('network-indexer-ws').value = 'ws://127.0.0.1:8088/api/v4/graphql/ws';
      $('network-environment-note').textContent = 'Local development needs your own running node, indexer and prover. Set Lace to the same local network.';
    } else {
      $('network-indexer').value = '';
      $('network-indexer-ws').value = '';
      $('network-environment-note').textContent = 'Preprod needs your own working service access, such as a Midnight Preprod Blockfrost project. Configure matching endpoints here and in Lace. Do not use the retired Midnight-hosted Preprod endpoints.';
    }
    $('network-service-settings').open = network !== 'preview';
    $('network-service-status').textContent = network === 'preview'
      ? 'Not checked yet. Checking services does not connect a wallet or submit a transaction.'
      : 'The public-service check is available for the shared Preview setup.';
    refreshControls();
  };
  const verifyPreviewServices = async () => {
    $('network-service-status').textContent = 'Checking the public Preview node and indexer…';
    try {
      const result = await checkPreviewPublicServices();
      $('network-service-status').textContent = `Preview’s node and HTTP indexer are reachable. Indexer block: ${result.blockHeight}. This checks service access only, not your wallet, prover or a transaction.`;
      return result;
    } catch (error) {
      $('network-service-status').textContent = formatPreviewServiceError(error)
        ?? 'The public Preview service check could not finish. Try again. This check does not use your wallet or local prover.';
      throw error;
    }
  };
  $('network-id').addEventListener('change', selectEnvironment);
  for (const id of ['network-receipt-id', 'network-address', 'network-digest']) $(id).addEventListener('input', clearReceiptIdResult);
  click('network-check-services', async () => {
    if ($('network-id').value !== 'preview') throw new Error('Select public Preview');
    await verifyPreviewServices();
    status('Public Preview services are reachable. You can now connect Lace on Preview. Test DUST and a running local prover are needed when you submit transactions.');
  });
  document.querySelectorAll('input[name="network-choice"], input[name="network-pair"]').forEach(input => input.addEventListener('change', refreshControls));
  document.querySelectorAll('input[name="network-trustee"]').forEach(input => input.addEventListener('change', () => {
    $('network-share').value = ''; $('network-trustee-file-status').textContent = ''; refreshControls();
  }));
  $('network-share').addEventListener('input', () => { $('network-trustee-file-status').textContent = ''; });
  $('network-refresh-wallets').addEventListener('click', refreshWallets);
  for (const mode of ['create', 'join']) $(`network-mode-${mode}`).addEventListener('click', () => {
    if (busy || client?.contractAddress) return;
    setupMode = mode; refreshControls();
  });
  $('network-connect-form').addEventListener('invalid', eventObject => {
    $('network-connection-status').textContent = eventObject.target.id === 'network-password'
      ? 'Enter a password of at least 16 characters for this app before connecting. Use three character types and avoid sequences or repeated characters. This is separate from your Lace password.'
      : 'Complete the highlighted connection setting before connecting. No wallet request has been sent.';
    $('network-connection-status').scrollIntoView({ block: 'nearest' });
  }, true);
  $('network-connect-form').addEventListener('submit', eventObject => {
    eventObject.preventDefault();
    void run(async () => {
      const selected = wallets.find(item => item.id === $('network-wallet').value);
      if (!selected) {
        status('No compatible wallet is available in this browser. Open this page in the browser where Lace is installed, enable Midnight, then reload and refresh the wallet list. No connection was requested.');
        return;
      }
      validateNativeStoragePassword($('network-password').value);
      const configuration = $('network-id').value === 'preview' ? previewBrowserConfiguration()
        : { networkId: $('network-id').value, indexerUri: $('network-indexer').value,
          indexerWsUri: $('network-indexer-ws').value, compiledAssetsUrl: './native-contract' };
      if (configuration.networkId === 'preview') {
        status('Checking Preview’s public services before requesting wallet access…');
        await verifyPreviewServices();
      }
      session?.close(); session = null; client = null; state = null; latestReceipt = null; manifest = null; dealer = null;
      resetSessionDisplay();
      // The SDK requests this password when it encrypts storage. It stays in a
      // masked input and is never copied into logs, exports, URLs or source.
      status('Requesting a connection from Lace. Open the Lace extension if its permission window does not appear. No transaction approval is needed for this step.');
      const connected = await connectNativeBrowserProviders({ wallet: selected.wallet,
        configuration,
        passwordProvider: () => $('network-password').value,
        onStage: stage => {
          if (connectionStages[stage]) status(connectionStages[stage]);
          else if (stages[stage]) event(stages[stage]);
        },
      });
      try {
        const connectedClient = createNativeSdkClient(connected.providers, connected);
        session = connected; client = connectedClient;
      } catch (error) {
        connected.close();
        throw error;
      }
      status(`Connected to ${session.networkId}. Create or join a test election. No proof or transaction has been completed yet.`);
    }, { connection: true });
  });
  click('network-disconnect', async () => {
    session?.close(); session = null; client = null; state = null; dealer = null; manifest = null; latestReceipt = null;
    for (const id of ['network-password', 'network-admin', 'network-voter', 'network-setup-secret', 'network-setup-slope', 'network-share']) $(id).value = '';
    lockAdministratorField();
    for (const role of keyRoles) {
      setKeyVisibility(role, false); $(`network-import-${role}`).value = '';
      $(`network-${role}-key-status`).textContent = 'Key cleared from this page. Any downloaded copy remains on your device.';
    }
    resetSessionDisplay();
    $('network-public-state').textContent = 'Local session ended';
    status('Disconnected and cleared the private fields. Saved encrypted keys and wallet permissions remain; remove permissions in your wallet if you want to revoke access.');
    $('network-connection-status').textContent = 'Disconnected. You can select a wallet and connect again.';
  });
  click('network-join', async () => {
    manifest = null; latestReceipt = null; resetSessionDisplay();
    await client.join($('network-address').value.trim().toLowerCase(), bytes($('network-digest').value.trim()));
    await refreshState(); status('The contract keys and settings match your indexer’s record. Its initial setup and blockchain history still need independent checks.');
  });
  $('network-import-election').addEventListener('change', () => void run(async () => {
    try {
      if (client?.contractAddress || setupMode !== 'join') throw new Error('Choose Join before loading election details');
      const record = await readElectionJoinFile($('network-import-election').files?.[0], session?.networkId ?? $('network-id').value);
      $('network-address').value = record.contractAddress;
      $('network-digest').value = record.configurationDigest;
      clearReceiptIdResult();
      $('network-election-file-status').textContent = 'Election details loaded. Connect a wallet on this network, then click Join election. Loading this file has not joined or verified the election.';
      status('Election details loaded. No connection or transaction was made.');
    } catch {
      $('network-election-file-status').textContent = 'Could not load election details. Choose a valid election-details .json file for the selected network, up to 4 KB. The address and fingerprint have not changed.';
      status('Election-details file rejected. The existing details have not changed.');
    } finally { $('network-import-election').value = ''; }
  }));
  click('network-download-election', async () => {
    if (!hasConfiguredElection()) throw new Error('Register trustee keys or join a configured election first');
    await refreshState();
    const record = electionDetails();
    saveJsonText(`midnight-election-${record.contractAddress.slice(0, 12)}.json`, encodeElectionJoinFile(record));
    status('Public election details downloaded. Load this file under Join an election when you return.');
  });
  for (let index = 1; index <= 3; index++) {
    click(`network-download-trustee-${index}`, async () => {
      try {
        if (!dealer || !hasConfiguredElection()) throw new Error('Trustee shares unavailable');
        await refreshState();
        const record = { schema: 'midnight-ballot-lab/trustee-key/v1', ...electionDetails(),
          trusteeIndex: index, secretShare: String(dealer.trustees.find(item => item.index === BigInt(index)).secretShare) };
        assertTrusteeKeyMatches(record, state.trusteeKeys, Native.pureCircuits.nativePublicKey);
        saveJsonText(`midnight-trustee-${index}-${record.contractAddress.slice(0, 12)}.private.json`, encodeTrusteeKeyFile(record));
        $('network-trustee-download-status').textContent = `Trustee ${index} key download started. Give this private, unencrypted file only to trustee ${index}.`;
        status(`Trustee ${index} private key download started. No transaction was submitted.`);
      } catch {
        $('network-trustee-download-status').textContent = 'Could not download this trustee key. The app must reach the configured election and match the share in this tab to its registered public key. Keep this session open and use the shares originally registered for this election.';
        status('Trustee key download failed. No key was exported.');
      }
    });
  }
  $('network-import-trustee').addEventListener('change', () => void run(async () => {
    try {
      const record = await readTrusteeKeyFile($('network-import-trustee').files?.[0], electionDetails());
      await refreshState();
      assertTrusteeKeyMatches(record, state.trusteeKeys, Native.pureCircuits.nativePublicKey);
      // Commit both fields only after file/context/native-key validation succeeds.
      $(`network-trustee-${record.trusteeIndex}`).checked = true;
      $('network-share').type = 'password';
      $('network-share').value = record.secretShare;
      $('network-trustee-file-status').textContent = `Trustee ${record.trusteeIndex} selected and key loaded hidden. It matches this election’s registered public key. Click Submit trustee contribution when you are ready.`;
      status('Trustee key loaded. No contribution or transaction was submitted.');
    } catch {
      $('network-trustee-file-status').textContent = 'Could not load this trustee key. Join its election, then choose the matching private .json file, up to 4 KB. The selected trustee and key have not changed.';
      status('Trustee key file rejected. The existing trustee and key have not changed.');
    } finally { $('network-import-trustee').value = ''; }
  }));
  $('network-use-existing-admin').addEventListener('click', () => void run(async () => {
    $('network-admin').readOnly = false;
    $('network-admin').placeholder = 'Paste your saved 64-character key';
    setKeyVisibility('admin', false);
    $('network-admin-key-status').textContent = 'Administrator key entry unlocked. Paste the key saved for this election, or load its private key file. The current value has not been cleared.';
    status('You can now enter an existing administrator key. No transaction was submitted.');
  }).then(() => { if (!busy && !$('network-admin').readOnly) $('network-admin').focus(); }));
  for (const role of keyRoles) {
    const input = $(`network-${role}`), feedback = $(`network-${role}-key-status`);
    input.addEventListener('input', () => { feedback.textContent = ''; refreshControls(); });
    click(`network-generate-${role}`, async () => {
      input.value = hex(randomSecret32()); setKeyVisibility(role, true);
      if (role === 'admin') lockAdministratorField();
      feedback.textContent = `${keyName(role)} key created and shown above. Download the private key file to keep a copy.`;
      status(`${keyName(role)} key created. Use Download key beside the key field to save it.`);
    });
    click(`network-show-${role}`, async () => {
      const visible = input.type === 'password'; setKeyVisibility(role, visible);
      feedback.textContent = `${keyName(role)} key ${visible ? 'shown' : 'hidden'}.`;
      status(`${keyName(role)} key ${visible ? 'shown' : 'hidden'}.`);
    });
    click(`network-download-${role}`, async () => {
      // This is an explicitly requested private download, separate from receipts
      // and public records. Never put the key in a URL, filename, log or export.
      const text = privateKeyText(input.value);
      const filename = role === 'voter' ? await nextVoterFilename() : 'midnight-administrator-key.private.txt';
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback.textContent = `${keyName(role)} key download started. This private text file is unencrypted; keep it separate from public receipts.`;
      status(`${keyName(role)} private key download started.`);
    });
    $(`network-import-${role}`).addEventListener('change', () => void run(async () => {
      try {
        const key = await readPrivateKeyFile($(`network-import-${role}`).files?.[0]);
        input.value = key; setKeyVisibility(role, false);
        if (role === 'admin') lockAdministratorField();
        feedback.textContent = `${keyName(role)} key loaded and hidden. Use Show key to see it. The election checks whether this is the right key when you use it.`;
        status(`${keyName(role)} key loaded. No transaction was submitted.`);
      } catch {
        feedback.textContent = 'Could not load this key. Choose a .txt file up to 256 bytes containing exactly one nonzero, 64-character hexadecimal key. The existing key has not changed.';
        status('Key file rejected. The existing key has not changed.');
      } finally { $(`network-import-${role}`).value = ''; }
    }));
  }
  click('network-generate-dealer', async () => {
    if (state?.keysConfigured === true || client?.configurationDigest) throw new Error('Keep the trustee shares already registered for this election');
    dealer = createDemoDealer(); $('network-setup-secret').value = String(dealer.setupSecret); $('network-setup-slope').value = String(dealer.setupSlope);
    status('Created all three trustee key shares in this tab. Use “Register trustee keys” to send the public keys to the network.');
  });
  click('network-deploy', async () => {
    const choices = $('network-choices').value.split(/\r?\n/).map(value => value.trim());
    if (choices.length < 2 || choices.length > 5 || new Set(choices).size !== choices.length || choices.some(value => !value || value.length > 40) || !$('network-title').value.trim()) throw new Error('Two to five different named choices required');
    const opens = Date.parse($('network-opens').value), closes = Date.parse($('network-closes').value);
    if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens <= Date.now() || closes <= opens) throw new Error('Future network schedule required');
    manifest = null;
    const deploymentManifest = { schema: 'midnight-ballot-lab/election-manifest/v1', title: $('network-title').value.trim(), choices };
    const manifestDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(deploymentManifest))));
    const result = await client.deploy({ electionId: randomSecret32(), manifestDigest, candidateCount: choices.length,
      administratorIdentity: Native.pureCircuits.administratorIdentity(privateKeyBytes($('network-admin').value)),
      opensAt: BigInt(Math.floor(opens / 1000)), closesAt: BigInt(Math.floor(closes / 1000)) });
    manifest = deploymentManifest;
    confirmed('Deployment', result); await refreshState();
    choices.forEach((choice, index) => { $(`network-choice-label-${index}`).textContent = choice; });
  });
  click('network-configure', async () => {
    const result = await client.configureKeys({ administratorSecret: privateKeyBytes($('network-admin').value),
      setupSecret: scalar($('network-setup-secret').value), setupSlope: scalar($('network-setup-slope').value) });
    $('network-setup-secret').value = ''; $('network-setup-slope').value = '';
    confirmed('Key configuration', result); await refreshState();
  });
  click('network-enroll', async () => {
    const ledger = await client.readPublicLedger();
    const member = Native.pureCircuits.memberIdentity(ledger.electionId, privateKeyBytes($('network-voter').value));
    confirmed('Enrollment', await client.enroll(member, privateKeyBytes($('network-admin').value))); await refreshState();
  });
  click('network-open', async () => { confirmed('Voting opened', await client.openVoting()); await refreshState(); });
  click('network-cast', async () => {
    const selection = selectedValue('network-choice');
    if (!/^[0-4]$/.test(selection) || Number(selection) >= Number(state?.candidateCount)) throw new Error('Choose a configured candidate');
    latestReceipt = null;
    clearReceiptDisplay();
    try {
      latestReceipt = await client.castBallot({ voterSecret: privateKeyBytes($('network-voter').value), selection: BigInt(selection) });
      confirmed('Ballot', latestReceipt); showReceipt(); await refreshState();
    } finally { clearSelection('network-choice'); }
  });
  click('network-save-receipt', async () => { savePublicJson('midnight-network-receipt.json', latestReceipt); status('Public receipt saved.'); });
  click('network-copy-receipt-id', async () => {
    if (!latestReceipt) throw new Error('No receipt available');
    try { await navigator.clipboard.writeText(latestReceipt.receipt); status('Receipt ID copied. Save the full receipt too, so you keep its election context.'); }
    catch { status('The browser could not copy the receipt ID. Select the displayed ID and copy it manually.'); }
  });
  click('network-recover-receipt', async () => {
    latestReceipt = await client.recoverPendingReceipt();
    clearReceiptIdResult(); showReceipt(); await refreshState();
    status('Your pending vote matches the encrypted ballot returned by the indexer. Nothing was submitted again. Its transaction reference and blockchain inclusion have not been independently verified.');
  });
  click('network-close', async () => { confirmed('Voting closed', await client.closeVoting()); await refreshState(); });
  click('network-use-share', async () => {
    const trustee = selectedValue('network-trustee');
    if (!/^[123]$/.test(trustee)) throw new Error('Choose one trustee');
    $('network-share').value = String(dealer.trustees.find(item => item.index === BigInt(trustee)).secretShare);
    $('network-trustee-file-status').textContent = '';
    status('Loaded this demo trustee’s private share. It has not been submitted.');
  });
  click('network-submit-share', async () => {
    const trustee = selectedValue('network-trustee');
    if (!/^[123]$/.test(trustee)) throw new Error('Choose one trustee');
    confirmed('Trustee contribution', await client.submitDecryption(BigInt(trustee), scalar($('network-share').value)));
    $('network-share').value = ''; $('network-trustee-file-status').textContent = ''; await refreshState();
  });
  click('network-finalize', async () => {
    const pair = selectedValue('network-pair');
    if (!['1,2', '1,3', '2,3'].includes(pair)) throw new Error('Choose a trustee pair');
    const [first, second] = pair.split(',').map(BigInt);
    const totals = await client.recoverTally(first, second);
    confirmed('Tally finalized', await client.finalize(first, second, totals)); await refreshState();
  });
  click('network-read', async () => { await refreshState(); status('Updated the election record from your indexer. The blockchain has not been independently verified.'); });
  click('network-refresh-voting', async () => {
    await refreshState();
    status('Voting status refreshed from the election record. Read Ready to vote? for the next step. No transaction was submitted.');
  });
  click('network-export', async () => {
    const ledger = client.configurationDigest ? await client.refreshConfiguration() : await client.readPublicLedger();
    let boundManifest = null;
    if (manifest) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest))));
      if (hex(digest) === hex(ledger.manifestDigest)) boundManifest = manifest;
    }
    const { schema, execution, network, proofGenerated, ledgerInclusionVerified, warning, ...publicFields } = projectNativePublicLedger(ledger, { contractAddress: client.contractAddress });
    savePublicJson('midnight-indexed-public-observation.json', {
      schema: 'midnight-ballot-lab/native-indexed-observation/v1', source: 'configured-indexer', networkId: session.networkId,
      proofPackageIncluded: false, ledgerInclusionIndependentlyVerified: false,
      warning: 'An indexer observation is not authenticated chain evidence or a portable native proof package.',
      ...publicFields, ...(boundManifest ? { electionManifest: boundManifest } : {}),
    });
    status('Election record downloaded. It contains what your indexer reported, without independent authentication.');
  });
  click('network-check-receipt', async () => {
    await client.checkReceipt(decodeNetworkReceipt($('network-receipt-input').value.trim()));
    status('Your receipt matches the encrypted ballot and election settings returned by the indexer. Its transaction reference and blockchain inclusion have not been independently verified.');
  });
  click('network-check-receipt-id', async () => {
    clearReceiptIdResult();
    const receiptId = $('network-receipt-id').value.trim();
    if (!/^[0-9a-f]{64}$/i.test(receiptId)) {
      $('network-receipt-id-result').textContent = 'Paste exactly 64 hexadecimal characters for the receipt ID. For a full receipt or QR text, use the full-receipt check below.';
    } else {
      try {
        await client.checkReceiptId(receiptId);
        $('network-receipt-id-result').textContent = 'Receipt ID found in this election’s encrypted ballot record. This lookup does not prove who cast it or independently verify the blockchain. Use the full-receipt check to compare its election details.';
      } catch {
        $('network-receipt-id-result').textContent = 'The receipt ID could not be verified in this election’s indexed record. Check the selected election and ID, then refresh and try again. This does not establish whether a transaction was accepted; do not submit another vote based on this message.';
      }
    }
    status('Receipt ID check finished. See the result beside the receipt ID input.');
  });
  selectEnvironment(); refreshWallets(); refreshControls();
  renderElectionTiming();
  // Paint the last read public state only. No provider call or transaction is
  // triggered by this timer; the user refreshes the election record explicitly.
  setInterval(() => { renderElectionTiming(); refreshVotingControls(); }, 1000);
}
