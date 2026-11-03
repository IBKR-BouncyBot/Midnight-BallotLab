import { connectNativeBrowserProviders } from '../contracts/native/browser-providers.mjs';
import { findNativeWallets, nativeNetworkErrorMessage } from '../contracts/native/browser-config.mjs';
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
  'proving-provider-started': 'The SDK prepared a transaction; the wallet proving provider is running.',
  'proving-provider-completed': 'Proving provider returned. This is not network acceptance; deployment needs no contract-call proof.',
  'wallet-approval-requested': 'Wallet approval and fee balancing requested.',
  'wallet-balanced': 'Wallet returned a balanced, signed transaction.',
  'submission-returned': 'Wallet submission returned. Awaiting indexer confirmation.',
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
  const selectedValue = name => document.querySelector(`input[name="${name}"]:checked`)?.value ?? '';
  const clearSelection = name => document.querySelectorAll(`input[name="${name}"]`).forEach(input => { input.checked = false; });
  const resetSessionDisplay = () => {
    ['network-choice', 'network-trustee', 'network-pair'].forEach(clearSelection);
    $('network-share').value = '';
    for (let index = 0; index < 3; index++) $(`network-choice-label-${index}`).textContent = `Choice ${index}`;
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
  const status = message => { $('network-status').textContent = message; $('network-status').hidden = false; };
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
    $('network-cast').disabled = !canChooseBallot || !/^[012]$/.test(selectedValue('network-choice'));
    $('network-trustee').disabled = busy || !client?.configurationDigest;
    $('network-pair').disabled = busy || !client?.configurationDigest;
    $('network-submit-share').disabled = busy || !client?.configurationDigest || !/^[123]$/.test(selectedValue('network-trustee'));
    $('network-finalize').disabled = busy || !client?.configurationDigest || !['1,2', '1,3', '2,3'].includes(selectedValue('network-pair'));
    $('network-configure').disabled = busy || !client?.contractAddress || state?.keysConfigured === true;
    $('network-use-share').disabled = busy || !dealer || !/^[123]$/.test(selectedValue('network-trustee'));
    $('network-save-receipt').disabled = busy || !latestReceipt;
    $('network-recover-receipt').disabled = busy || !client?.pendingBallotReceipt;
    $('network-disconnect').disabled = busy || !session;
    $('network-password').readOnly = Boolean(session);
  };
  const run = async operation => {
    if (busy) return;
    busy = true; refreshControls(); status('Operation in progress. Keep this page open.');
    try { await operation(); }
    catch (error) { status(client?.pendingBallotReceipt
      ? 'This session has a pending ballot with an uncertain submission outcome. Check its receipt without resubmitting. Before ending the session or trying again, check the transaction status through your wallet or a trusted network service.'
      : nativeNetworkErrorMessage(error)); }
    finally { busy = false; refreshControls(); }
  };
  const click = (id, operation) => $(id).addEventListener('click', () => void run(operation));
  const confirmed = (label, result) => {
    if (typeof result?.txId !== 'string') throw new Error('Missing SDK transaction identifier');
    event(`${label}: configured indexer confirmed ${result.txId} at block ${result.blockHeight}.`);
    status(`${label} confirmed by the configured indexer. Independent chain inclusion has not been verified.`);
  };
  const refreshState = async () => {
    state = await client.readPublicLedger();
    $('network-address').value = client.contractAddress;
    if (client.configurationDigest) $('network-digest').value = hex(client.configurationDigest);
    $('network-public-state').textContent = JSON.stringify({ network: session.networkId,
      contractAddress: client.contractAddress, keysConfigured: state.keysConfigured,
      configurationDigest: hex(state.configurationDigest), phase: Number(state.phase), accepted: Number(state.accepted),
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
    $('network-wallet-note').textContent = !wallets.length ? 'No compatible wallet detected. Install or unlock a DApp Connector API 4 wallet in this browser.'
      : duplicates ? 'Several entries claim the same wallet identity. Review your installed extensions and choose carefully.'
        : 'Choose the installed wallet you intend to use; extension identity is not authenticated by this page.';
  };
  document.querySelectorAll('input[name="network-choice"], input[name="network-pair"]').forEach(input => input.addEventListener('change', refreshControls));
  document.querySelectorAll('input[name="network-trustee"]').forEach(input => input.addEventListener('change', () => {
    $('network-share').value = ''; refreshControls();
  }));
  $('network-refresh-wallets').addEventListener('click', refreshWallets);
  $('network-connect-form').addEventListener('submit', eventObject => {
    eventObject.preventDefault();
    void run(async () => {
      const selected = wallets.find(item => item.id === $('network-wallet').value);
      if (!selected) throw new Error('Select a compatible wallet');
      session?.close(); session = null; client = null; state = null; latestReceipt = null; manifest = null; dealer = null;
      resetSessionDisplay();
      // The SDK requests this password when it encrypts storage. It stays in a
      // masked input and is never copied into logs, exports, URLs or source.
      session = await connectNativeBrowserProviders({ wallet: selected.wallet,
        configuration: { networkId: $('network-id').value, indexerUri: $('network-indexer').value,
          indexerWsUri: $('network-indexer-ws').value, compiledAssetsUrl: './native-contract' },
        passwordProvider: () => $('network-password').value,
        onStage: stage => { if (stages[stage]) event(stages[stage]); },
      });
      client = createNativeSdkClient(session.providers, session);
      status(`Connected to ${session.networkId}. Deploy or join a test election. No proof or network transaction has been completed.`);
    });
  });
  click('network-disconnect', async () => {
    session?.close(); session = null; client = null; state = null; dealer = null; manifest = null; latestReceipt = null;
    for (const id of ['network-password', 'network-admin', 'network-voter', 'network-setup-secret', 'network-setup-slope', 'network-share']) $(id).value = '';
    resetSessionDisplay();
    $('network-public-state').textContent = 'Local session ended';
    status('Local session ended and private input fields cleared. Wallet permissions and encrypted browser storage remain; revoke permissions in the wallet if needed.');
  });
  click('network-join', async () => {
    manifest = null; latestReceipt = null; resetSessionDisplay();
    await client.join($('network-address').value.trim().toLowerCase(), bytes($('network-digest').value.trim()));
    await refreshState(); status('Verifier keys and configuration match the indexed contract. Initial state and chain authenticity require separate verification.');
  });
  click('network-generate-admin', async () => { $('network-admin').value = hex(randomSecret32()); status('Synthetic administrator credential created in this tab. Retain it securely before leaving.'); });
  click('network-generate-voter', async () => { $('network-voter').value = hex(randomSecret32()); status('Synthetic voter credential created in this tab. It has not been enrolled.'); });
  click('network-generate-dealer', async () => {
    dealer = createDemoDealer(); $('network-setup-secret').value = String(dealer.setupSecret); $('network-setup-slope').value = String(dealer.setupSlope);
    status('Centralized synthetic dealer created all three private shares in this tab. No keys have been submitted.');
  });
  click('network-deploy', async () => {
    const choices = $('network-choices').value.split(/\r?\n/).map(value => value.trim());
    if (choices.length !== 3 || choices.some(value => !value || value.length > 40) || !$('network-title').value.trim()) throw new Error('Three named choices required');
    const opens = Date.parse($('network-opens').value), closes = Date.parse($('network-closes').value);
    if (!Number.isFinite(opens) || !Number.isFinite(closes) || opens <= Date.now() || closes <= opens) throw new Error('Future network schedule required');
    manifest = null;
    const deploymentManifest = { schema: 'midnight-ballot-lab/election-manifest/v1', title: $('network-title').value.trim(), choices };
    const manifestDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(deploymentManifest))));
    const result = await client.deploy({ electionId: randomSecret32(), manifestDigest,
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
    if (!/^[012]$/.test(selection)) throw new Error('Choose a candidate');
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
    status('Pending ballot matches the indexed ciphertext. No new transaction was submitted. Its transaction reference and independent chain inclusion remain unverified.');
  });
  click('network-close', async () => { confirmed('Voting closed', await client.closeVoting()); await refreshState(); });
  click('network-use-share', async () => {
    const trustee = selectedValue('network-trustee');
    if (!/^[123]$/.test(trustee)) throw new Error('Choose one trustee');
    $('network-share').value = String(dealer.trustees.find(item => item.index === BigInt(trustee)).secretShare);
    status('Selected synthetic share loaded privately. No trustee contribution has been submitted.');
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
  click('network-read', async () => { await refreshState(); status('Public state refreshed from the configured indexer. Independent chain inclusion is unverified.'); });
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
    status('Public indexer observation saved. It is not an independently authenticated election record.');
  });
  click('network-check-receipt', async () => {
    await client.checkReceipt(decodeNetworkReceipt($('network-receipt-input').value.trim()));
    status('Receipt matches the configured indexer ciphertext and pinned configuration. Transaction reference and independent chain inclusion are unverified.');
  });
  refreshWallets(); refreshControls();
}
