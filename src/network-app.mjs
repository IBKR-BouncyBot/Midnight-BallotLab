import { connectNativeBrowserProviders, nativeStoragePasswordMessage, validateNativeStoragePassword } from '../contracts/native/browser-providers.mjs';
import { findNativeWallets, nativeNetworkErrorMessage } from '../contracts/native/browser-config.mjs';
import { PREVIEW_PUBLIC_SERVICES, previewBrowserConfiguration, checkPreviewPublicServices, formatPreviewServiceError } from '../contracts/native/public-testnet.mjs';
import { createNativeSdkClient } from '../contracts/native/sdk-client.mjs';
import { createDemoDealer, randomSecret32, requireBytes32, requireScalar } from '../contracts/native/adapter.mjs';
import { projectNativePublicLedger } from '../contracts/native/record.mjs';
import * as Native from '../contracts/managed/native-election/contract/index.js';
import { encodeNetworkReceipt, decodeNetworkReceipt } from './network-receipt.mjs';
import { qrSvg } from './qr.mjs';

const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
const bytes = value => {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new TypeError('Expected 32 hexadecimal bytes');
  return requireBytes32(Uint8Array.from(value.match(/../g), item => parseInt(item, 16)));
};
const scalar = value => {
  if (!/^[1-9][0-9]{0,76}$/.test(value)) throw new TypeError('Expected canonical decimal scalar');
  return requireScalar(BigInt(value));
};
const stages = Object.freeze({
  'wallet-connected': 'Wallet connected. No transaction submitted.',
  'proving-provider-started': 'Preparing the transaction and any required proofs…',
  'proving-provider-completed': 'Transaction preparation finished. The network has not accepted it yet.',
  'wallet-approval-requested': 'Check your wallet to approve the transaction and its fee.',
  'wallet-balanced': 'Your wallet signed the transaction.',
  'submission-returned': 'Transaction submitted. Waiting for confirmation from your indexer…',
});

function savePublicJson(filename, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const selectedValue = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? '';
  const clearSelection = name => document.querySelectorAll(`input[name="${name}"]`).forEach(input => { input.checked = false; });
  const resetSessionDisplay = () => {
    ['network-choice', 'network-trustee', 'network-pair'].forEach(clearSelection);
    $('network-share').value = '';
    for (let index = 0; index < 5; index++) {
      $(`network-choice-label-${index}`).textContent = `Choice ${index}`;
      $(`network-choice-${index}`).closest('label').hidden = index >= 3;
    }
    $('network-receipt-panel').hidden = true;
    $('network-receipt-code').textContent = '';
    $('network-receipt-qr').replaceChildren();
    $('network-receipt-input').value = '';
    $('network-public-state').textContent = 'No contract connected';
  };
  const event = message => {
    const item = document.createElement('p'); item.textContent = message; $('network-events').prepend(item);
    while ($('network-events').children.length > 30) $('network-events').lastElementChild.remove();
  };
  const status = message => {
    $('network-status').textContent = message; $('network-status').hidden = false;
    if (connectionFeedback) $('network-connection-status').textContent = message;
  };
  const refreshControls = () => {
    controls.forEach(control => { control.disabled = busy; });
    const requireClient = ['network-join', 'network-deploy'];
    const requireContract = ['network-read', 'network-configure', 'network-export'];
    const requireConfigured = ['network-enroll', 'network-open', 'network-cast', 'network-close', 'network-submit-share', 'network-finalize', 'network-check-receipt'];
    for (const id of requireClient) $(id).disabled = busy || !client || Boolean(client.contractAddress);
    for (const id of requireContract) $(id).disabled = busy || !client?.contractAddress;
    for (const id of requireConfigured) $(id).disabled = busy || !client?.configurationDigest;
    const canChooseBallot = !busy && Boolean(client?.configurationDigest) && state?.phase === 1n && !client.pendingBallotReceipt;
    $('network-selection').disabled = !canChooseBallot;
    $('network-cast').disabled = !canChooseBallot || !/^[0-4]$/.test(selectedValue('network-choice')) || Number(selectedValue('network-choice')) >= Number(state?.candidateCount);
    $('network-trustee').disabled = busy || !client?.configurationDigest;
    $('network-pair').disabled = busy || !client?.configurationDigest;
    $('network-submit-share').disabled = busy || !client?.configurationDigest || !/^[123]$/.test(selectedValue('network-trustee'));
    $('network-finalize').disabled = busy || !client?.configurationDigest || !['1,2', '1,3', '2,3'].includes(selectedValue('network-pair'));
    $('network-configure').disabled = busy || !client?.contractAddress || state?.keysConfigured === true;
    $('network-use-share').disabled = busy || !dealer || !/^[123]$/.test(selectedValue('network-trustee'));
    $('network-save-receipt').disabled = busy || !latestReceipt;
    $('network-recover-receipt').disabled = busy || !client?.pendingBallotReceipt;
    $('network-disconnect').disabled = busy || !session;
    $('network-connect').disabled = busy || Boolean(session);
    $('network-password').readOnly = Boolean(session);
    // A connected client stays bound to one wallet/network. Do not let the
    // displayed selection change while that session can still transact.
    for (const id of ['network-id', 'network-wallet', 'network-refresh-wallets']) $(id).disabled = busy || Boolean(session);
    for (const id of ['network-indexer', 'network-indexer-ws']) $(id).readOnly = Boolean(session) || $('network-id').value === 'preview';
    $('network-check-services').disabled = busy || $('network-id').value !== 'preview';
  };
  const run = async (operation, { connection = false } = {}) => {
    if (busy) return;
    connectionFeedback = connection;
    busy = true; refreshControls(); status('Working… Keep this page open until the action finishes.');
    try { await operation(); }
    catch (error) { status(client?.pendingBallotReceipt
      ? 'Your vote was sent, but its status is uncertain. Use “Check pending vote” and check your wallet before trying again or closing this page.'
      : formatPreviewServiceError(error) ?? nativeStoragePasswordMessage(error) ?? nativeNetworkErrorMessage(error)); }
    finally { busy = false; connectionFeedback = false; refreshControls(); }
  };
  const click = (id, operation) => $(id).addEventListener('click', () => void run(operation));
  const confirmed = (label, result) => {
    if (typeof result?.txId !== 'string') throw new Error('Missing SDK transaction identifier');
    event(`${label}: configured indexer confirmed ${result.txId} at block ${result.blockHeight}.`);
    status(`${label}: your indexer reports confirmation. This app has not independently verified the blockchain.`);
  };
  const refreshState = async () => {
    state = await client.readPublicLedger();
    const candidateCount = Number(state.candidateCount);
    if (!Number.isInteger(candidateCount) || candidateCount < 2 || candidateCount > 5) throw new Error('Unsupported candidate count');
    for (let index = 0; index < 5; index++) $(`network-choice-${index}`).closest('label').hidden = index >= candidateCount;
    $('network-address').value = client.contractAddress;
    if (client.configurationDigest) $('network-digest').value = hex(client.configurationDigest);
    $('network-public-state').textContent = JSON.stringify({ network: session.networkId,
      contractAddress: client.contractAddress, keysConfigured: state.keysConfigured,
      configurationDigest: hex(state.configurationDigest), candidateCount, phase: Number(state.phase), accepted: Number(state.accepted),
      opensAt: String(state.opensAt), closesAt: String(state.closesAt), totals: state.finalizedTotals.map(Number),
      source: 'configured-indexer', independentlyVerified: false }, null, 2);
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
  click('network-check-services', async () => {
    if ($('network-id').value !== 'preview') throw new Error('Select public Preview');
    await verifyPreviewServices();
    status('Public Preview services are reachable. You can now connect Lace on Preview. Test DUST and a running local prover are needed when you submit transactions.');
  });
  document.querySelectorAll('input[name="network-choice"], input[name="network-pair"]').forEach(input => input.addEventListener('change', refreshControls));
  document.querySelectorAll('input[name="network-trustee"]').forEach(input => input.addEventListener('change', () => {
    $('network-share').value = ''; refreshControls();
  }));
  $('network-refresh-wallets').addEventListener('click', refreshWallets);
  $('network-connect-form').addEventListener('invalid', eventObject => {
    $('network-connection-status').textContent = eventObject.target.id === 'network-password'
      ? 'Enter a password of at least 16 characters for this app before connecting. Use three character types and avoid sequences or repeated characters. This is separate from your Lace password.'
      : 'Complete the highlighted connection setting before connecting. No wallet request has been sent.';
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
        onStage: stage => { if (stages[stage]) event(stages[stage]); },
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
  click('network-generate-admin', async () => { $('network-admin').value = hex(randomSecret32()); status('Administrator key created. Keep it somewhere secure before leaving this page.'); });
  click('network-generate-voter', async () => { $('network-voter').value = hex(randomSecret32()); status('Voter key created. Register this voter before casting a vote.'); });
  click('network-generate-dealer', async () => {
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
      administratorIdentity: Native.pureCircuits.administratorIdentity(bytes($('network-admin').value)),
      opensAt: BigInt(Math.floor(opens / 1000)), closesAt: BigInt(Math.floor(closes / 1000)) });
    manifest = deploymentManifest;
    confirmed('Deployment', result); await refreshState();
    choices.forEach((choice, index) => { $(`network-choice-label-${index}`).textContent = choice; });
  });
  click('network-configure', async () => {
    const result = await client.configureKeys({ administratorSecret: bytes($('network-admin').value),
      setupSecret: scalar($('network-setup-secret').value), setupSlope: scalar($('network-setup-slope').value) });
    $('network-setup-secret').value = ''; $('network-setup-slope').value = '';
    confirmed('Key configuration', result); await refreshState();
  });
  click('network-enroll', async () => {
    const ledger = await client.readPublicLedger();
    const member = Native.pureCircuits.memberIdentity(ledger.electionId, bytes($('network-voter').value));
    confirmed('Enrollment', await client.enroll(member, bytes($('network-admin').value))); await refreshState();
  });
  click('network-open', async () => { confirmed('Voting opened', await client.openVoting()); await refreshState(); });
  click('network-cast', async () => {
    const selection = selectedValue('network-choice');
    if (!/^[0-4]$/.test(selection) || Number(selection) >= Number(state?.candidateCount)) throw new Error('Choose a configured candidate');
    latestReceipt = null;
    $('network-receipt-panel').hidden = true;
    $('network-receipt-code').textContent = '';
    $('network-receipt-qr').replaceChildren();
    try {
      latestReceipt = await client.castBallot({ voterSecret: bytes($('network-voter').value), selection: BigInt(selection) });
      const code = encodeNetworkReceipt(latestReceipt);
      $('network-receipt-code').textContent = code; $('network-receipt-qr').innerHTML = qrSvg(code);
      $('network-receipt-panel').hidden = false; confirmed('Ballot', latestReceipt); await refreshState();
    } finally { clearSelection('network-choice'); }
  });
  click('network-save-receipt', async () => { savePublicJson('midnight-network-receipt.json', latestReceipt); status('Public receipt saved.'); });
  click('network-recover-receipt', async () => {
    latestReceipt = await client.recoverPendingReceipt();
    const code = encodeNetworkReceipt(latestReceipt);
    $('network-receipt-code').textContent = code; $('network-receipt-qr').innerHTML = qrSvg(code);
    $('network-receipt-panel').hidden = false; await refreshState();
    status('Your pending vote matches the encrypted ballot returned by the indexer. Nothing was submitted again. Its transaction reference and blockchain inclusion have not been independently verified.');
  });
  click('network-close', async () => { confirmed('Voting closed', await client.closeVoting()); await refreshState(); });
  click('network-use-share', async () => {
    const trustee = selectedValue('network-trustee');
    if (!/^[123]$/.test(trustee)) throw new Error('Choose one trustee');
    $('network-share').value = String(dealer.trustees.find(item => item.index === BigInt(trustee)).secretShare);
    status('Loaded this demo trustee’s private share. It has not been submitted.');
  });
  click('network-submit-share', async () => {
    const trustee = selectedValue('network-trustee');
    if (!/^[123]$/.test(trustee)) throw new Error('Choose one trustee');
    confirmed('Trustee contribution', await client.submitDecryption(BigInt(trustee), scalar($('network-share').value)));
    $('network-share').value = ''; await refreshState();
  });
  click('network-finalize', async () => {
    const pair = selectedValue('network-pair');
    if (!['1,2', '1,3', '2,3'].includes(pair)) throw new Error('Choose a trustee pair');
    const [first, second] = pair.split(',').map(BigInt);
    const totals = await client.recoverTally(first, second);
    confirmed('Tally finalized', await client.finalize(first, second, totals)); await refreshState();
  });
  click('network-read', async () => { await refreshState(); status('Updated the election record from your indexer. The blockchain has not been independently verified.'); });
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
  selectEnvironment(); refreshWallets(); refreshControls();
}
