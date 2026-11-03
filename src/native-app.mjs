/** Actual generated Compact/runtime browser entry. No substitute cryptography.
 * Bundled only when the native generated modules and real runtime are present.
 */
import { createDemoDealer, freshBallotRandomness, randomSecret32, pointEqual } from '../contracts/native/adapter.mjs';
import { createNativeEmulator, loadNativeModules, nativePublicSnapshot, recoverNativeTally } from '../contracts/native/harness.mjs';
import { qrSvg } from './qr.mjs';
import { parseStrictJson } from './json.mjs';

const RECEIPT_SCHEMA = 'midnight-ballot-lab/native-emulator-receipt/v1';
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((value, i) => value === b[i]);
const bytesFromHex = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid native receipt digest');
  return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
};
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

function encodeReceipt(receipt) {
  const bytes = new Uint8Array(128);
  [receipt.contractAddress, receipt.electionId, receipt.configurationDigest, receipt.receipt].forEach((value, index) => bytes.set(bytesFromHex(value), index * 32));
  const payload = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `mbne1:${receipt.index}:${payload}`;
}

function decodeReceipt(text) {
  if (text.length > 4096) throw new Error('Receipt is too large');
  if (text.startsWith('mbne1:')) {
    const match = /^mbne1:(0|[1-9][0-9]{0,3}):([A-Za-z0-9_-]{171})$/.exec(text);
    if (!match) throw new Error('Invalid native emulator QR receipt');
    const bytes = Uint8Array.from(atob(match[2].replaceAll('-', '+').replaceAll('_', '/') + '='), char => char.charCodeAt(0));
    if (bytes.length !== 128) throw new Error('Invalid native emulator receipt length');
    const receipt = { schema: RECEIPT_SCHEMA, execution: 'generated-contract-emulator', network: null,
      contractAddress: hex(bytes.slice(0, 32)), electionId: hex(bytes.slice(32, 64)),
      configurationDigest: hex(bytes.slice(64, 96)), receipt: hex(bytes.slice(96)), index: Number(match[1]) };
    if (encodeReceipt(receipt) !== text) throw new Error('Receipt encoding is not canonical');
    return receipt;
  }
  const value = parseStrictJson(text, { maxBytes: 4096, maxDepth: 8 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a native emulator receipt');
  return value;
}

function savePublicJson(filename, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function initNativeDemo() {
  // Resolve the actual compiled modules before attaching or enabling controls.
  const { bindings } = await loadNativeModules();
  if (typeof bindings.Contract !== 'function' || typeof bindings.pureCircuits?.receiptDigest !== 'function') throw new Error('The generated native contract is incomplete');
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto?.subtle) throw new Error('A secure browser context with WebCrypto is required');
  const $ = id => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Native demo markup is incomplete');
    return element;
  };
  let session = null, lastReceipt = null, busy = false;
  let activePanel = 'setup';
  const events = [];

  function status(text, error = false, working = false) {
    const element = $('native-status');
    element.textContent = text;
    element.className = `global-status${error ? ' error' : ''}${working ? ' working' : ''}`;
    element.hidden = !text;
  }
  function log(text) {
    events.unshift(text);
    if (events.length > 8) events.pop();
    $('native-event-log').replaceChildren(...events.map(value => {
      const line = document.createElement('div'); line.className = 'event-entry'; line.textContent = value; return line;
    }));
  }
  function showPanel(name) {
    activePanel = name;
    document.querySelectorAll('[data-native-panel]').forEach(panel => { panel.hidden = panel.dataset.nativePanel !== name; });
    document.querySelectorAll('[data-native-nav]').forEach(button => {
      const active = button.dataset.nativeNav === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
  }
  function renderChoices() {
    const candidates = session?.manifest.candidates ?? ['Option A', 'Option B', 'Option C'];
    $('native-choices').replaceChildren(...candidates.map((candidate, index) => {
      const label = document.createElement('label'); label.className = 'candidate-card';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'native-choice'; input.value = String(index); input.required = true;
      const text = document.createElement('span'); text.textContent = candidate;
      const letter = document.createElement('span'); letter.className = 'candidate-letter'; letter.textContent = String.fromCharCode(65 + index);
      label.append(input, text, letter); return label;
    }));
  }
  function render() {
    const state = session?.emulator.readLedger();
    const phase = state?.phase;
    const canVote = phase === 1n && session.nextVoter < 5;
    $('native-voters').textContent = session ? '5' : '—';
    $('native-ballots').textContent = String(state?.accepted ?? 0n);
    $('native-phase').textContent = state ? ['Enrollment', 'Voting open', 'Voting closed', 'Finalized'][Number(phase)] : 'Not created';
    $('native-setup-form').hidden = !!session;
    $('native-setup-complete').hidden = !session;
    $('native-configuration').textContent = session?.configurationDigest ?? '';
    $('native-contract-address').textContent = session?.emulator.contractAddress ?? 'Not created';
    $('native-voter-label').textContent = !session ? 'Create an election to start voting.' : phase !== 1n
      ? 'Voting is closed in this experiment.' : session.nextVoter >= 5 ? 'All five synthetic credentials have voted.' : `Next credential: synthetic voter ${session.nextVoter + 1} of 5`;
    const enabled = {
      'native-election-title': !session, 'native-choice-a': !session, 'native-choice-b': !session, 'native-choice-c': !session,
      'native-create': !session, 'native-go-vote': !!session, 'native-choice-fieldset': canVote, 'native-cast': canVote,
      'native-close': phase === 1n && state.accepted > 0n, 'native-trustee-pair': phase === 2n, 'native-finalize': phase === 2n,
      'native-export': !!session, 'native-check-result': phase === 3n,
      'native-receipt-input': !!session, 'native-check-receipt': !!session,
      'native-save-receipt': !!lastReceipt, 'native-copy-receipt': !!lastReceipt, 'native-use-receipt': !!lastReceipt,
      'native-reset': true,
    };
    for (const [id, allowed] of Object.entries(enabled)) $(id).disabled = busy || !allowed;
    document.querySelectorAll('[data-native-nav]').forEach(button => { button.disabled = busy; });
    $('native-receipt-panel').hidden = !lastReceipt;
    $('native-results').hidden = phase !== 3n;
    $('native-ballot-list').replaceChildren();
    if (state?.accepted > 0n) {
      for (let index = 0n; index < state.accepted; index++) {
        const item = document.createElement('div'); item.className = 'ballot-item';
        const heading = document.createElement('div'); heading.className = 'ballot-item-head';
        const label = document.createElement('span'); label.textContent = `Encrypted ballot ${index + 1n}`;
        const badge = document.createElement('span'); badge.textContent = 'Native · local'; heading.append(label, badge);
        const code = document.createElement('code'); code.textContent = hex(state.ballotReceipts.lookup(index)); item.append(heading, code);
        $('native-ballot-list').append(item);
      }
    } else {
      const empty = document.createElement('p'); empty.className = 'notebook-empty'; empty.textContent = 'Accepted native receipts will appear here.'; $('native-ballot-list').append(empty);
    }
    if (phase === 3n) {
      $('native-result-count').textContent = `${state.accepted} encrypted ballots`;
      $('native-result-bars').replaceChildren(...session.manifest.candidates.map((candidate, index) => {
        const row = document.createElement('div'); row.className = 'result-row';
        const label = document.createElement('div'); label.className = 'result-label';
        const name = document.createElement('span'); name.textContent = candidate;
        const total = document.createElement('strong'); total.textContent = String(state.finalizedTotals[index]); label.append(name, total);
        const track = document.createElement('div'); track.className = 'result-track';
        const fill = document.createElement('div'); fill.className = 'result-fill'; fill.style.width = `${100 * Number(state.finalizedTotals[index]) / Number(state.accepted)}%`;
        track.append(fill); row.append(label, track); return row;
      }));
    }
    showPanel(activePanel);
  }
  async function operate(label, action) {
    if (busy) return;
    busy = true; render(); status(label, false, true);
    try { await nextFrame(); await action(); }
    catch { status('The native operation did not complete. No substitute protocol was used. Inspect the local phase before retrying; generated-runtime compatibility may require a rebuild.', true); }
    finally { session?.emulator.setPrivateState({}); busy = false; render(); }
  }
  function newReceipt(receipt, index) {
    const state = session.emulator.readLedger();
    return { schema: RECEIPT_SCHEMA, execution: 'generated-contract-emulator', network: null,
      contractAddress: session.emulator.contractAddress, electionId: hex(state.electionId),
      configurationDigest: session.configurationDigest, index: Number(index), receipt: hex(receipt),
      proofGenerated: false, ledgerInclusionVerified: false };
  }
  function checkReceipt(receipt) {
    const state = session.emulator.readLedger();
    if (receipt.schema !== RECEIPT_SCHEMA || receipt.execution !== 'generated-contract-emulator' || receipt.network !== null
      || receipt.contractAddress !== session.emulator.contractAddress || receipt.electionId !== hex(state.electionId)
      || receipt.configurationDigest !== session.configurationDigest || !Number.isSafeInteger(receipt.index)
      || receipt.index < 0 || BigInt(receipt.index) >= state.accepted) throw new Error('Receipt context does not match');
    const index = BigInt(receipt.index), stored = state.ballotReceipts.lookup(index);
    const expected = session.emulator.pureCircuits.receiptDigest(state.electionId, state.configurationDigest,
      state.nullifiers.lookup(index), state.ballotA.lookup(index), state.ballotB.lookup(index));
    if (!sameBytes(bytesFromHex(receipt.receipt), stored) || !sameBytes(stored, expected) || !state.receipts.member(stored)) throw new Error('Receipt does not match');
  }

  document.querySelectorAll('[data-native-nav]').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.nativeNav)));
  $('native-go-vote').addEventListener('click', () => showPanel('vote'));
  $('native-setup-form').addEventListener('submit', event => {
    event.preventDefault();
    operate('Initializing the actual native contract…', async () => {
      const title = $('native-election-title').value.trim();
      const candidates = ['a', 'b', 'c'].map(letter => $(`native-choice-${letter}`).value.trim());
      if (!title || candidates.some(value => !value) || new Set(candidates).size !== 3) { status('Enter an experiment name and three different choices.', true); return; }
      const dealer = createDemoDealer(), administratorSecret = randomSecret32(), electionId = randomSecret32();
      const opensAt = Math.floor(Date.now() / 1000) + 60, closesAt = opensAt + 600;
      const manifest = { schema: 'midnight-ballot-lab/native-demo-manifest/v1', execution: 'emulator',
        electionId: hex(electionId), title, candidates, threshold: 2, capacity: 1024, syntheticVoters: 5, opensAt, closesAt };
      // External metadata commitment; native identity/configuration/receipt hashes
      // are calculated by Compact, not this WebCrypto SHA-256 call.
      const manifestDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(manifest))));
      const emulator = await createNativeEmulator({ electionId, manifestDigest, administratorSecret,
        setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope, opensAt, closesAt });
      const voters = Array.from({ length: 5 }, randomSecret32);
      for (const secret of voters) emulator.call('enroll', emulator.pureCircuits.memberIdentity(electionId, secret));
      emulator.setPrivateState({}); emulator.setTime(opensAt + 1); emulator.call('openVoting');
      session = { emulator, voters, trustees: dealer.trustees, nextVoter: 0, manifest, closesAt,
        configurationDigest: hex(emulator.readLedger().configurationDigest), finalizedPair: null };
      renderChoices(); log('Native key configuration and enrollment completed. Five synthetic credentials.');
      status('Native election initialized. Generated circuits are running locally; no proofs or transactions were created.');
    });
  });
  $('native-vote-form').addEventListener('submit', event => {
    event.preventDefault();
    operate('Encrypting with native Jubjub operations…', async () => {
      if (!session || session.emulator.readLedger().phase !== 1n || session.nextVoter >= 5) throw new Error('Voting is not available');
      const selected = document.querySelector('input[name="native-choice"]:checked');
      if (!selected || !/^[012]$/.test(selected.value)) { status('Select one choice before casting.', true); return; }
      const selection = BigInt(selected.value), voterSecret = session.voters[session.nextVoter];
      const emulator = session.emulator, state = emulator.readLedger(), pure = emulator.pureCircuits;
      const member = pure.memberIdentity(state.electionId, voterSecret);
      const randomness = freshBallotRandomness();
      const nullifier = pure.voterNullifier(state.electionId, voterSecret);
      const a = randomness.map(value => pure.nativePublicKey(value));
      const b = randomness.map((value, candidate) => pure.addPoints(pure.scalePoint(state.publicKey, value), pure.nativePublicKey(selection === BigInt(candidate) ? 1n : 0n)));
      const expectedReceipt = pure.receiptDigest(state.electionId, state.configurationDigest, nullifier, a, b);
      const index = state.accepted;
      emulator.setPrivateState({ voterSecret, selection, eligibilityPath: state.members.findPathForLeaf(member), ballotRandomness: randomness });
      const receipt = emulator.call('castBallot');
      // Clear a successful credential and selection even if a subsequent display
      // or consistency check fails; retry must not cast the same credential.
      session.voters[session.nextVoter] = null; session.nextVoter++;
      $('native-vote-form').reset(); emulator.setPrivateState({});
      if (!sameBytes(receipt, expectedReceipt)) throw new Error('Native receipt differs from the locally constructed ballot');
      lastReceipt = newReceipt(receipt, index); checkReceipt(lastReceipt);
      $('native-receipt-hash').textContent = lastReceipt.receipt;
      $('native-receipt-qr').innerHTML = qrSvg(encodeReceipt(lastReceipt));
      log(`Encrypted ballot ${index + 1n} accepted by the generated local contract.`);
      status('Native ballot accepted locally. Its receipt matches the ciphertext constructed from your selected input.');
    });
  });
  $('native-close').addEventListener('click', () => operate('Freezing the native ciphertext aggregate…', async () => {
    if (!session) throw new Error('No native election');
    session.emulator.setPrivateState({}); session.emulator.setTime(session.closesAt); session.emulator.call('closeVoting');
    log('Voting closed. Native ciphertext aggregate frozen.'); status('Voting is closed. Choose two trustees to recover the aggregate.');
  }));
  $('native-finalize').addEventListener('click', () => operate('Computing native trustee shares and tally equations…', async () => {
    if (!session) throw new Error('No native election');
    const pairText = $('native-trustee-pair').value;
    if (!['1,2', '1,3', '2,3'].includes(pairText)) throw new Error('Invalid trustee pair');
    const pair = pairText.split(',').map(BigInt), emulator = session.emulator;
    for (const index of pair) {
      if (!emulator.readLedger().submittedTrustees.member(index)) {
        emulator.setPrivateState({ trusteeSecretShare: session.trustees[Number(index) - 1].secretShare });
        emulator.call('submitDecryption', index);
      }
      emulator.setPrivateState({}); await nextFrame();
    }
    const totals = recoverNativeTally(emulator, ...pair);
    emulator.call('finalize', ...pair, totals); session.finalizedPair = pair;
    log(`Native aggregate finalized using trustees ${pairText.replace(',', ' + ')}.`);
    status('Native tally equations passed in the local runtime. Only aggregate totals are displayed.');
  }));
  $('native-save-receipt').addEventListener('click', () => { if (lastReceipt) savePublicJson('native-emulator-receipt.json', lastReceipt); });
  $('native-copy-receipt').addEventListener('click', () => operate('Copying the public native receipt code…', async () => {
    if (!lastReceipt) throw new Error('No receipt');
    const code = encodeReceipt(lastReceipt);
    try { await navigator.clipboard.writeText(code); status('Native receipt code copied.'); }
    catch { $('native-receipt-input').value = code; $('native-receipt-check-output').textContent = ''; showPanel('check'); status('Clipboard access was unavailable. The public receipt is in the receipt field for manual copying.'); }
  }));
  $('native-receipt-input').addEventListener('input', () => { $('native-receipt-check-output').textContent = ''; });
  $('native-use-receipt').addEventListener('click', () => {
    if (lastReceipt) $('native-receipt-input').value = encodeReceipt(lastReceipt);
    $('native-receipt-check-output').textContent = '';
  });
  $('native-check-receipt').addEventListener('click', () => {
    const output = $('native-receipt-check-output');
    try {
      if (!session) throw new Error('No native experiment');
      checkReceipt(decodeReceipt($('native-receipt-input').value.trim()));
      output.className = 'inline-status pass'; output.textContent = 'Receipt matches the current native emulator’s accepted ciphertext record. No chain inclusion or ZK proof was verified.';
    } catch { output.className = 'inline-status fail'; output.textContent = 'Receipt rejected: its format, experiment context, accepted index or native hash does not match this session.'; }
  });
  $('native-export').addEventListener('click', () => operate('Preparing the public native snapshot…', async () => {
    if (!session) throw new Error('No native experiment');
    const snapshot = { ...nativePublicSnapshot(session.emulator), manifest: session.manifest };
    savePublicJson('native-emulator-public.json', snapshot);
    status('Public native snapshot exported. It contains no private inputs and is explicitly marked as an unauthenticated emulator record.');
  }));
  $('native-check-result').addEventListener('click', () => operate('Recomputing native public data…', async () => {
    const output = $('native-check-output'); output.hidden = true;
    try {
      if (!session || !session.finalizedPair) throw new Error('No finalized native experiment');
      const emulator = session.emulator, state = emulator.readLedger(), pure = emulator.pureCircuits;
      if (state.phase !== 3n || state.accepted < 1n || state.accepted > 5n) throw new Error('Invalid local phase or count');
      const manifestDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(session.manifest))));
      if (!sameBytes(manifestDigest, state.manifestDigest)) throw new Error('Displayed manifest does not match the configured digest');
      const config = pure.configurationDigestFor(state.electionId, state.manifestDigest, state.administrator,
        state.opensAt, state.closesAt, state.publicKey, state.coefficientKey, state.trusteeKeys);
      if (!sameBytes(config, state.configurationDigest) || hex(config) !== session.configurationDigest) throw new Error('Configuration changed');
      const sumsA = Array.from({ length: 3 }, () => pure.nativePublicKey(0n));
      const sumsB = Array.from({ length: 3 }, () => pure.nativePublicKey(0n));
      const nullifiers = new Set(), receipts = new Set();
      for (let index = 0n; index < state.accepted; index++) {
        const a = state.ballotA.lookup(index), b = state.ballotB.lookup(index), nul = state.nullifiers.lookup(index), receipt = state.ballotReceipts.lookup(index);
        if (nullifiers.has(hex(nul)) || receipts.has(hex(receipt))) throw new Error('Duplicate public identifier');
        nullifiers.add(hex(nul)); receipts.add(hex(receipt));
        if (!sameBytes(receipt, pure.receiptDigest(state.electionId, state.configurationDigest, nul, a, b)) || !state.receipts.member(receipt) || !state.spent.member(nul)) throw new Error('Invalid local receipt');
        for (let candidate = 0; candidate < 3; candidate++) {
          sumsA[candidate] = pure.addPoints(sumsA[candidate], a[candidate]);
          sumsB[candidate] = pure.addPoints(sumsB[candidate], b[candidate]);
        }
        await nextFrame();
      }
      if (sumsA.some((point, i) => !pointEqual(point, state.aggregateA[i])) || sumsB.some((point, i) => !pointEqual(point, state.aggregateB[i]))) throw new Error('Aggregate mismatch');
      const totals = recoverNativeTally(emulator, ...session.finalizedPair);
      if (totals.some((value, i) => value !== state.finalizedTotals[i]) || totals.reduce((a, b) => a + b, 0n) !== state.accepted) throw new Error('Tally mismatch');
      output.className = 'verification-result';
      output.textContent = `Native public consistency checks passed for ${state.accepted} ballots: manifest labels, configuration, unique nullifiers and receipts, receipt hashes, summed ciphertexts and aggregate tally. No private inputs were read by this check. This does not verify native ZK proofs or authenticated chain inclusion.`;
      status('Native public consistency checks passed.');
    } catch {
      output.className = 'verification-result failure'; output.textContent = 'Native public consistency checks failed. This record must not be treated as verified.';
      status('Native public checks failed.', true);
    }
    output.hidden = false;
  }));
  $('native-reset').addEventListener('click', () => {
    if (busy) return;
    session?.emulator.setPrivateState({}); session = null; lastReceipt = null; events.length = 0;
    $('native-event-log').replaceChildren(); $('native-vote-form').reset(); $('native-receipt-input').value = '';
    $('native-receipt-check-output').textContent = ''; $('native-check-output').hidden = true;
    $('native-receipt-qr').replaceChildren(); $('native-receipt-hash').textContent = '';
    renderChoices(); showPanel('setup'); render(); status('Native experiment reset. Create a new synthetic election to continue.');
  });
  renderChoices(); render();
  return { mode: 'generated-contract-emulator', proofGenerated: false, networkTransactionSubmitted: false };
}
