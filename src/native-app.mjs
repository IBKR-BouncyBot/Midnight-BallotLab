/** Actual generated Compact/runtime browser entry. No substitute cryptography.
 * Bundled only when the native generated modules and real runtime are present.
 */
import { createDemoDealer, freshBallotRandomness, randomSecret32, pointEqual, NATIVE_CAPACITY, NATIVE_CANDIDATES,
  NATIVE_MIN_CANDIDATES, NATIVE_MAX_CANDIDATES } from '../contracts/native/adapter.mjs';
import { createNativeEmulator, loadNativeModules, nativePublicSnapshot, recoverNativeTally } from '../contracts/native/harness.mjs';
import { nativeManifestDigest, verifyNativePublicSnapshot } from '../contracts/native/verify-public.mjs';
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
const setupWindowExpired = () => Object.assign(new Error('Setup opening window elapsed'), { code: 'SETUP_WINDOW_EXPIRED' });

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
    return validateReceiptShape(receipt);
  }
  const value = parseStrictJson(text, { maxBytes: 4096, maxDepth: 8 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a native emulator receipt');
  return validateReceiptShape(value);
}

function validateReceiptShape(receipt) {
  const required = ['schema', 'execution', 'network', 'contractAddress', 'electionId', 'configurationDigest', 'index', 'receipt'];
  const allowed = new Set([...required, 'proofGenerated', 'ledgerInclusionVerified']);
  if (required.some(key => !Object.hasOwn(receipt, key)) || Object.keys(receipt).some(key => !allowed.has(key))
    || receipt.schema !== RECEIPT_SCHEMA || receipt.execution !== 'generated-contract-emulator' || receipt.network !== null
    || !Number.isSafeInteger(receipt.index) || receipt.index < 0 || receipt.index >= NATIVE_CAPACITY
    || Object.hasOwn(receipt, 'proofGenerated') && receipt.proofGenerated !== false
    || Object.hasOwn(receipt, 'ledgerInclusionVerified') && receipt.ledgerInclusionVerified !== false) throw new Error('Invalid public receipt');
  for (const key of ['contractAddress', 'electionId', 'configurationDigest', 'receipt']) bytesFromHex(receipt[key]);
  return receipt;
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
  let session = null, lastReceipt = null, verifiedImport = null, busy = false, scheduleTimer = null;
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
    const candidates = session?.manifest.candidates ?? ['a', 'b', 'c', 'd', 'e']
      .slice(0, Number($('native-candidate-count').value)).map(letter => $(`native-choice-${letter}`).value);
    $('native-choices').replaceChildren(...candidates.map((candidate, index) => {
      const label = document.createElement('label'); label.className = 'candidate-card selection-card';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'native-choice'; input.value = String(index); input.required = true;
      input.id = `native-choice-${index}`; label.htmlFor = input.id;
      const text = document.createElement('span'); text.className = 'selection-copy';
      const title = document.createElement('strong'); title.textContent = candidate;
      const hint = document.createElement('small'); hint.textContent = 'Select this choice'; text.append(title, hint);
      const letter = document.createElement('span'); letter.className = 'candidate-letter'; letter.textContent = String.fromCharCode(65 + index);
      label.append(input, text, letter); return label;
    }));
  }
  function renderVoters() {
    const previous = $('native-voter').value;
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a demo voter';
    const options = session?.voters.map((secret, index) => {
      const option = document.createElement('option'); option.value = String(index); option.disabled = !secret;
      option.textContent = `Demo voter ${index + 1}${secret ? '' : ' — already voted'}`; return option;
    }) ?? [];
    $('native-voter').replaceChildren(placeholder, ...options);
    $('native-voter').value = previous !== '' && session?.voters[Number(previous)] ? previous : '';
  }
  const selectedTrustees = () => [...document.querySelectorAll('input[name="native-trustee"]:checked')].map(input => input.value);
  function invalidateImport() {
    verifiedImport = null; $('native-check-source').value = 'session';
    $('native-check-output').hidden = true; $('native-receipt-check-output').textContent = '';
  }
  function updateScheduleStatus() {
    const element = $('native-schedule-status');
    element.hidden = session?.manifest.timingMode !== 'scheduled';
    if (element.hidden) return;
    const now = Math.floor(Date.now() / 1000), phase = session.emulator.readLedger().phase;
    const text = phase === 3n ? 'Timed election complete. Voting is closed and the results are ready.'
      : session.scheduleFailed ? 'The timed election stopped before finishing. Check the election status before resetting.'
        : now < session.manifest.opensAt ? `Timed election · voting opens in ${session.manifest.opensAt - now}s. Keep this tab open.`
          : now < session.closesAt ? `Timed election · ${session.closesAt - now}s left to vote. Trustees 1 + 3 will reveal the results when voting closes.`
            : 'Timed election · voting has ended. Checking both trustees and preparing the results…';
    if (element.textContent !== text) element.textContent = text;
  }
  function render() {
    const state = session?.emulator.readLedger();
    const phase = state?.phase;
    const scheduled = session?.manifest.timingMode === 'scheduled';
    const canVote = phase === 1n && session.voters.some(Boolean) && (!scheduled || Math.floor(Date.now() / 1000) < session.closesAt);
    renderVoters();
    $('native-voters').textContent = session ? String(session.voters.length) : '—';
    $('native-ballots').textContent = String(state?.accepted ?? 0n);
    $('native-phase').textContent = state ? ['Getting ready', 'Voting open', 'Voting closed', 'Results ready'][Number(phase)] : 'Not created';
    $('native-setup-form').hidden = !!session;
    $('native-setup-complete').hidden = !session;
    $('native-configuration').textContent = session?.configurationDigest ?? '';
    $('native-contract-address').textContent = session?.emulator.contractAddress ?? 'Not created';
    $('native-setup-summary').textContent = session ? `${session.voters.length} demo voters are ready. ${phase === 0n ? 'Voting opens after the countdown.' : 'Your election is ready.'}` : '';
    $('native-voter-label').textContent = !session ? 'Set up an election to start voting.' : phase !== 1n
      ? phase === 0n ? 'Voting has not opened yet.' : 'Voting is closed.' : !canVote ? 'No more demo voters can vote in this election.' : 'Choose a demo voter who has not voted yet. Voter names are not saved with ballots.';
    const receiptContext = $('native-check-source').value === 'import' ? verifiedImport : session;
    const enabled = {
      'native-election-title': !session, 'native-voter-count': !session, 'native-candidate-count': !session,
      'native-timing-mode': !session, 'native-duration': !session && $('native-timing-mode').value === 'scheduled',
      'native-create': !session, 'native-go-vote': !!session, 'native-voter': canVote,
      'native-choice-fieldset': canVote && $('native-voter').value !== '', 'native-cast': canVote && $('native-voter').value !== '',
      'native-close': !scheduled && phase === 1n && state.accepted > 0n, 'native-trustee-fieldset': !scheduled && phase === 2n,
      'native-finalize': !scheduled && phase === 2n && selectedTrustees().length === 2,
      'native-export': !!session, 'native-check-result': phase === 3n,
      'native-receipt-input': !!receiptContext, 'native-receipt-file': !!receiptContext, 'native-check-receipt': !!receiptContext,
      'native-import-file': true, 'native-import-text': true, 'native-expected-digest': true, 'native-verify-import': true,
      'native-check-source': !!session || !!verifiedImport,
      'native-save-receipt': !!lastReceipt, 'native-copy-receipt': !!lastReceipt, 'native-use-receipt': !!lastReceipt,
      'native-reset': true,
    };
    for (const [id, allowed] of Object.entries(enabled)) $(id).disabled = busy || !allowed;
    $('native-duration-settings').hidden = $('native-timing-mode').value !== 'scheduled';
    updateScheduleStatus();
    $('native-check-source').querySelector('option[value="session"]').disabled = !session;
    $('native-check-source').querySelector('option[value="import"]').disabled = !verifiedImport;
    $('native-verification-context').textContent = $('native-check-source').value === 'import' && verifiedImport
      ? `Checking the uploaded record “${verifiedImport.result.snapshot.manifest.title}”. Election code: ${verifiedImport.result.snapshot.configurationDigest}.`
      : session ? `Checking this tab’s election “${session.manifest.title}”. Election code: ${session.configurationDigest}.`
        : 'Create an election or check an uploaded record first. You do not need voter or trustee secrets to check a shared record.';
    document.querySelectorAll('[data-native-choice-setting]').forEach(wrapper => {
      const hidden = Number(wrapper.dataset.nativeChoiceSetting) >= Number($('native-candidate-count').value);
      wrapper.hidden = hidden;
      const input = wrapper.querySelector('input'); input.disabled = busy || !!session || hidden; input.required = !hidden;
    });
    const trusteeCount = selectedTrustees().length;
    document.querySelectorAll('input[name="native-trustee"]').forEach(input => { input.disabled = trusteeCount === 2 && !input.checked; });
    $('native-trustee-selection').textContent = trusteeCount === 2
      ? `Trustees ${selectedTrustees().join(' + ')} selected. ${phase === 3n ? 'Both contributions agree with the results.' : 'Both will help reveal the result.'}`
      : `Choose two trustees · ${trusteeCount} of 2 selected`;
    document.querySelectorAll('[data-native-nav]').forEach(button => { button.disabled = busy; });
    $('native-receipt-panel').hidden = !lastReceipt;
    $('native-results').hidden = phase !== 3n;
    $('native-ballot-list').replaceChildren();
    if (state?.accepted > 0n) {
      for (let index = 0n; index < state.accepted; index++) {
        const item = document.createElement('div'); item.className = 'ballot-item';
        const heading = document.createElement('div'); heading.className = 'ballot-item-head';
        const label = document.createElement('span'); label.textContent = `Encrypted ballot ${index + 1n}`;
        const badge = document.createElement('span'); badge.textContent = 'Recorded'; heading.append(label, badge);
        const code = document.createElement('code'); code.textContent = hex(state.ballotReceipts.lookup(index)); item.append(heading, code);
        $('native-ballot-list').append(item);
      }
    } else {
      const empty = document.createElement('p'); empty.className = 'notebook-empty'; empty.textContent = 'Your saved ballot receipts will appear here.'; $('native-ballot-list').append(empty);
    }
    if (phase === 3n) {
      $('native-result-count').textContent = `${state.accepted} encrypted ballots`;
      $('native-result-bars').replaceChildren(...session.manifest.candidates.map((candidate, index) => {
        const row = document.createElement('div'); row.className = 'result-row';
        const label = document.createElement('div'); label.className = 'result-label';
        const name = document.createElement('span'); name.textContent = candidate;
        const total = document.createElement('strong'); total.textContent = String(state.finalizedTotals[index]); label.append(name, total);
        const track = document.createElement('div'); track.className = 'result-track';
        const fill = document.createElement('div'); fill.className = 'result-fill'; fill.style.width = `${state.accepted > 0n ? 100 * Number(state.finalizedTotals[index]) / Number(state.accepted) : 0}%`;
        track.append(fill); row.append(label, track); return row;
      }));
    }
    showPanel(activePanel);
  }
  async function operate(label, action) {
    if (busy) return;
    busy = true; render(); status(label, false, true);
    try {
      await nextFrame();
      if (session?.manifest.timingMode === 'scheduled') session.emulator.setTime(Math.floor(Date.now() / 1000));
      await action();
    }
    catch (error) { status(error?.code === 'SETUP_WINDOW_EXPIRED'
      ? 'Setup needs more time on this device. Close other tabs or choose fewer demo voters, then create the election again.'
      : 'This step did not finish. Check the election status before trying again.', true); }
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
  document.querySelectorAll('input[name="native-trustee"]').forEach(input => input.addEventListener('change', render));
  $('native-candidate-count').addEventListener('change', () => { renderChoices(); render(); });
  $('native-timing-mode').addEventListener('change', render);
  $('native-voter').addEventListener('change', () => {
    document.querySelectorAll('input[name="native-choice"]').forEach(input => { input.checked = false; });
    lastReceipt = null; $('native-receipt-qr').replaceChildren(); $('native-receipt-hash').textContent = '';
    status('Choose a ballot option for this demo voter.');
    render();
  });
  $('native-go-vote').addEventListener('click', () => showPanel('vote'));
  $('native-setup-form').addEventListener('submit', event => {
    event.preventDefault();
    operate('Creating your election…', async () => {
      const title = $('native-election-title').value.trim();
      const voterCount = Number($('native-voter-count').value), candidateCount = Number($('native-candidate-count').value);
      const timingMode = $('native-timing-mode').value;
      const durationSeconds = timingMode === 'manual' ? 600 : Number($('native-duration').value);
      if (!['manual', 'scheduled'].includes(timingMode) || !Number.isInteger(durationSeconds) || durationSeconds < 15 || durationSeconds > 3600) { status('Choose manual mode or a timed election lasting 15–3,600 seconds.', true); return; }
      if (!Number.isInteger(voterCount) || voterCount < 1 || voterCount > NATIVE_CAPACITY) { status(`Choose a whole voter count from 1 to ${NATIVE_CAPACITY}.`, true); return; }
      if (!Number.isInteger(candidateCount) || candidateCount < NATIVE_MIN_CANDIDATES || candidateCount > NATIVE_MAX_CANDIDATES) { status('Choose between two and five choices.', true); return; }
      const candidates = ['a', 'b', 'c', 'd', 'e'].slice(0, candidateCount).map(letter => $(`native-choice-${letter}`).value.trim());
      if (!title || title.length > 80 || candidates.some(value => !value || value.length > 40) || new Set(candidates).size !== candidateCount) { status('Enter an election name and different choices for every option.', true); return; }
      const dealer = createDemoDealer(), administratorSecret = randomSecret32(), electionId = randomSecret32();
      // Prepare private credentials and their actual native identities before
      // choosing immutable deadlines. None of these index-to-identity mappings
      // leave this tab or enter the public operation log.
      const voters = Array.from({ length: voterCount }, randomSecret32);
      const members = [];
      for (let index = 0; index < voters.length; index++) {
        members.push(bindings.pureCircuits.memberIdentity(electionId, voters[index]));
        if ((index + 1) % 8 === 0 || index === voters.length - 1) {
          status(`Preparing demo voters: ${index + 1} of ${voterCount}…`, false, true); await nextFrame();
        }
      }
      let emulator, manifest, closesAt;
      let openingLeadSeconds = Math.max(10, Math.ceil(voterCount / 8));
      const attempts = timingMode === 'scheduled' ? 3 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const attemptStartedAt = performance.now();
        const opensAt = Math.ceil(Date.now() / 1000) + (timingMode === 'scheduled' ? openingLeadSeconds : 60);
        closesAt = opensAt + durationSeconds;
        manifest = { schema: 'midnight-ballot-lab/native-demo-manifest/v2', execution: 'emulator',
          electionId: hex(electionId), title, candidates, threshold: 2, capacity: NATIVE_CAPACITY, syntheticVoters: voterCount,
          timingMode, durationSeconds, opensAt, closesAt };
        const requireSetupWindow = () => {
          const actualTime = Math.floor(Date.now() / 1000);
          if (timingMode === 'scheduled' && actualTime >= opensAt) throw setupWindowExpired();
          return actualTime;
        };
        try {
          // Each retry constructs a fresh, unexposed local election. Its dates
          // and configuration are never modified after construction.
          const manifestDigest = await nativeManifestDigest(manifest);
          const initialTime = requireSetupWindow();
          emulator = await createNativeEmulator({ electionId, manifestDigest, administratorSecret,
            setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope, opensAt, closesAt, candidateCount,
            ...(timingMode === 'scheduled' ? { initialTime } : {}) });
          for (let index = 0; index < members.length; index++) {
            const actualTime = requireSetupWindow();
            if (timingMode === 'scheduled') emulator.setTime(actualTime);
            emulator.call('enroll', members[index]);
            if ((index + 1) % 8 === 0 || index === members.length - 1) {
              status(`Adding demo voters: ${index + 1} of ${voterCount}…`, false, true); await nextFrame();
            }
          }
          requireSetupWindow();
          emulator.setPrivateState({});
          if (timingMode === 'manual') { emulator.setTime(opensAt + 1); emulator.call('openVoting'); }
          break;
        } catch (error) {
          emulator?.setPrivateState({}); emulator = null;
          if (error?.code !== 'SETUP_WINDOW_EXPIRED' || attempt === attempts - 1) throw error;
          const elapsedSeconds = Math.ceil((performance.now() - attemptStartedAt) / 1000);
          openingLeadSeconds = Math.max(openingLeadSeconds * 2, elapsedSeconds * 2 + 5);
          status('Setup needs more time. Restarting with a longer opening countdown…', false, true);
          await nextFrame();
        }
      }
      if (!emulator) throw setupWindowExpired();
      session = { emulator, voters, trustees: dealer.trustees, manifest, closesAt,
        configurationDigest: hex(emulator.readLedger().configurationDigest), finalizedPair: null };
      renderChoices(); log(`Election created with ${voterCount} demo voters.`);
      status(timingMode === 'scheduled' ? 'Your timed election is ready. Voting starts after the countdown. Keep this tab open until the results appear.'
        : 'Your election is ready. Choose a demo voter to cast the first ballot.');
      if (timingMode === 'scheduled') startSchedule();
    });
  });
  $('native-vote-form').addEventListener('submit', event => {
    event.preventDefault();
    operate('Encrypting your vote…', async () => {
      if (!session || session.emulator.readLedger().phase !== 1n) throw new Error('Voting is not available');
      const voterIndex = Number($('native-voter').value);
      if ($('native-voter').value === '' || !Number.isInteger(voterIndex) || !session.voters[voterIndex]) throw new Error('Choose an unused synthetic voter');
      const selected = document.querySelector('input[name="native-choice"]:checked');
      if (!selected || !/^[0-4]$/.test(selected.value) || Number(selected.value) >= session.manifest.candidates.length) { status('Select one choice before casting.', true); return; }
      const selection = BigInt(selected.value), voterSecret = session.voters[voterIndex];
      const emulator = session.emulator, state = emulator.readLedger(), pure = emulator.pureCircuits;
      const member = pure.memberIdentity(state.electionId, voterSecret);
      const randomness = freshBallotRandomness();
      const nullifier = pure.voterNullifier(state.electionId, voterSecret);
      const a = randomness.map(value => pure.nativePublicKey(value));
      const b = randomness.map((value, candidate) => pure.addPoints(pure.scalePoint(state.publicKey, value), pure.nativePublicKey(selection === BigInt(candidate) ? 1n : 0n)));
      const expectedReceipt = pure.receiptDigest(state.electionId, state.configurationDigest, nullifier, a, b);
      const index = state.accepted;
      emulator.setPrivateState({ voterSecret, selection, eligibilityPath: state.members.findPathForLeaf(member), ballotRandomness: randomness });
      // Preparing the ciphertext may take time on a slow device. Enforce the
      // actual current deadline at the call, not the earlier preparation time.
      if (session.manifest.timingMode === 'scheduled') emulator.setTime(Math.floor(Date.now() / 1000));
      const receipt = emulator.call('castBallot');
      // Clear a successful credential and selection even if a subsequent display
      // or consistency check fails; retry must not cast the same credential.
      session.voters[voterIndex] = null; $('native-voter').value = '';
      $('native-vote-form').reset(); emulator.setPrivateState({});
      if (!sameBytes(receipt, expectedReceipt)) throw new Error('Native receipt differs from the locally constructed ballot');
      lastReceipt = newReceipt(receipt, index); checkReceipt(lastReceipt);
      $('native-receipt-hash').textContent = lastReceipt.receipt;
      $('native-receipt-qr').innerHTML = qrSvg(encodeReceipt(lastReceipt));
      log(`Encrypted ballot ${index + 1n} recorded.`);
      status('Your vote is recorded and encrypted. Save your receipt before choosing another voter.');
    });
  });
  $('native-close').addEventListener('click', () => operate('Closing voting…', async () => {
    if (!session || session.manifest.timingMode !== 'manual') throw new Error('Manual closing is unavailable');
    session.emulator.setPrivateState({}); session.emulator.setTime(session.closesAt); session.emulator.call('closeVoting');
    log('Voting closed. No more ballots can be cast.'); status('Voting is closed. Choose two trustees to reveal the results.');
  }));
  async function finalizePair(pairText) {
    if (!session) throw new Error('No native election');
    if (!['1,2', '1,3', '2,3'].includes(pairText)) throw new Error('Invalid trustee pair');
    const pair = pairText.split(',').map(BigInt), emulator = session.emulator;
    for (const index of pair) {
      if (!emulator.readLedger().submittedTrustees.member(index)) {
        if (session.manifest.timingMode === 'scheduled') emulator.setTime(Math.floor(Date.now() / 1000));
        emulator.setPrivateState({ trusteeSecretShare: session.trustees[Number(index) - 1].secretShare });
        emulator.call('submitDecryption', index);
      }
      emulator.setPrivateState({}); await nextFrame();
    }
    const totals = recoverNativeTally(emulator, ...pair);
    if (session.manifest.timingMode === 'scheduled') emulator.setTime(Math.floor(Date.now() / 1000));
    emulator.call('finalize', ...pair, totals); session.finalizedPair = pair;
    log(`Results revealed with trustees ${pairText.replace(',', ' + ')}.`);
    status('The two trustee contributions agree with the combined results.');
  }
  $('native-finalize').addEventListener('click', () => operate('Checking both trustees and revealing the results…', async () => {
    if (session?.manifest.timingMode !== 'manual') throw new Error('Manual tallying is unavailable');
    await finalizePair(selectedTrustees().join(','));
  }));
  async function finishScheduledElection() {
    session.emulator.setTime(Math.floor(Date.now() / 1000));
    session.emulator.setPrivateState({}); session.emulator.call('closeVoting');
    document.querySelectorAll('input[name="native-trustee"]').forEach(input => { input.checked = ['1', '3'].includes(input.value); });
    showPanel('tally'); await finalizePair('1,3');
  }
  function startSchedule() {
    clearInterval(scheduleTimer);
    scheduleTimer = setInterval(() => {
      if (!session || session.manifest.timingMode !== 'scheduled') { clearInterval(scheduleTimer); return; }
      updateScheduleStatus();
      if (busy || session.scheduleFailed) return;
      const now = Math.floor(Date.now() / 1000), phase = session.emulator.readLedger().phase;
      if (phase === 3n) { clearInterval(scheduleTimer); return; }
      if ((phase === 0n || phase === 1n) && now >= session.closesAt) {
        void operate('Closing voting and checking both trustees…', async () => {
          session.scheduleFailed = true;
          await finishScheduledElection(); session.scheduleFailed = false;
        });
      } else if (phase === 0n && now >= session.manifest.opensAt) {
        void operate('Opening voting…', async () => {
          session.scheduleFailed = true;
          if (Math.floor(Date.now() / 1000) >= session.closesAt) await finishScheduledElection();
          else {
            session.emulator.setPrivateState({}); session.emulator.call('openVoting');
            status('Voting is open. Keep this tab open until the results are ready.');
          }
          session.scheduleFailed = false;
        });
      }
    }, 250);
  }
  $('native-save-receipt').addEventListener('click', () => { if (lastReceipt) savePublicJson('midnight-ballot-receipt.json', lastReceipt); });
  $('native-copy-receipt').addEventListener('click', () => operate('Copying your receipt…', async () => {
    if (!lastReceipt) throw new Error('No receipt');
    const code = encodeReceipt(lastReceipt);
    try { await navigator.clipboard.writeText(code); status('Receipt copied.'); }
    catch { $('native-receipt-input').value = code; $('native-receipt-check-output').textContent = ''; showPanel('check'); status('Clipboard access was unavailable. Copy the receipt from the receipt field instead.'); }
  }));
  $('native-receipt-input').addEventListener('input', () => { $('native-receipt-file').value = ''; $('native-receipt-check-output').textContent = ''; });
  $('native-receipt-file').addEventListener('change', () => operate('Loading your receipt…', async () => {
    const output = $('native-receipt-check-output');
    output.textContent = ''; output.className = 'inline-status'; $('native-receipt-input').value = '';
    try {
      const file = $('native-receipt-file').files?.[0];
      if (!file || file.size > 4096 || !/\.(json|txt)$/i.test(file.name)) throw new Error('Invalid receipt file');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).trim();
      decodeReceipt(text); // Shape only. Context and inclusion still need an explicit check.
      $('native-receipt-input').value = text;
      status('Receipt loaded. Click Check receipt to compare it with the selected record.');
    } catch {
      $('native-receipt-file').value = '';
      output.className = 'inline-status fail'; output.textContent = 'Receipt file rejected. Choose a saved JSON receipt or QR text file up to 4 KiB.';
      status('The receipt file could not be read. No receipt has been checked.', true);
    }
  }));
  $('native-check-source').addEventListener('change', () => {
    $('native-receipt-check-output').textContent = ''; status('Election record changed. Check your receipt against the selected record.'); render();
  });
  for (const id of ['native-import-text', 'native-expected-digest']) $(id).addEventListener('input', () => {
    invalidateImport(); status('The record or election code changed. Check the record again before checking receipts.'); render();
  });
  $('native-import-file').addEventListener('change', () => operate('Loading the election record…', async () => {
    invalidateImport();
    const file = $('native-import-file').files?.[0];
    if (!file || file.size > 8 * 1024 * 1024) { status('Choose an election record JSON file no larger than 8 MiB.', true); return; }
    $('native-import-text').value = await file.text();
    status('Election record loaded. Check it before checking a receipt.');
  }));
  $('native-verify-import').addEventListener('click', () => operate('Checking the shared election record…', async () => {
    invalidateImport();
    const output = $('native-check-output');
    try {
      const jsonText = $('native-import-text').value;
      const expectedConfigurationDigest = $('native-expected-digest').value.trim() || undefined;
      const result = await verifyNativePublicSnapshot(jsonText, { expectedConfigurationDigest });
      verifiedImport = { jsonText, expectedConfigurationDigest, result };
      $('native-check-source').value = 'import';
      output.className = 'verification-result';
      output.textContent = `Record checks passed for ${result.accepted} ballots. ${result.finalized
        ? `Combined totals: ${result.totals.slice(0, result.candidateCount).join(', ')}. All published trustee pairs agree.`
        : 'This record has no final result yet.'} Every voter can check their receipt against this record. These checks do not prove who supplied the record, voter identity, fairness or blockchain confirmation.`;
      status('The record’s ballots and totals agree. Receipt checks now use the uploaded record.');
    } catch {
      output.className = 'verification-result failure';
      output.textContent = 'Record rejected. Some election details, ballots, trustee contributions or totals do not agree. Choose a valid shared record and try again.';
      status('The election record did not pass its checks.', true);
    }
    output.hidden = false;
  }));
  $('native-use-receipt').addEventListener('click', () => {
    if (lastReceipt) { $('native-receipt-input').value = encodeReceipt(lastReceipt); $('native-check-source').value = 'session'; }
    $('native-receipt-check-output').textContent = '';
    render();
  });
  $('native-check-receipt').addEventListener('click', () => operate('Checking your receipt…', async () => {
    const output = $('native-receipt-check-output');
    try {
      const receipt = decodeReceipt($('native-receipt-input').value.trim());
      if ($('native-check-source').value === 'import') {
        if (!verifiedImport) throw new Error('No verified imported record');
        const result = await verifyNativePublicSnapshot(verifiedImport.jsonText, { receipt,
          expectedConfigurationDigest: verifiedImport.expectedConfigurationDigest });
        if (!result.receiptMatched) throw new Error('Receipt does not match imported record');
      } else { if (!session) throw new Error('No native election'); checkReceipt(receipt); }
      output.className = 'inline-status pass'; output.textContent = 'Your receipt matches a recorded encrypted ballot in this election. This does not prove voter identity, fairness or blockchain confirmation.';
      status('Receipt matches the selected record.');
    } catch { output.className = 'inline-status fail'; output.textContent = 'This receipt does not match a recorded ballot in the selected election. Check that you chose the right election record and receipt.'; status('Receipt did not match the selected record.'); }
  }));
  $('native-export').addEventListener('click', () => operate('Preparing the election record…', async () => {
    if (!session) throw new Error('No native experiment');
    const snapshot = { ...nativePublicSnapshot(session.emulator), manifest: session.manifest };
    savePublicJson('midnight-election-record.json', snapshot);
    status('Election record downloaded. It contains public data only and can be checked in another tab.');
  }));
  $('native-check-result').addEventListener('click', () => operate('Checking the ballots and results…', async () => {
    const output = $('native-check-output'); output.hidden = true;
    try {
      if (!session || !session.finalizedPair) throw new Error('No finalized native experiment');
      const emulator = session.emulator, state = emulator.readLedger(), pure = emulator.pureCircuits;
      if (state.phase !== 3n || state.accepted < 0n || state.accepted > BigInt(session.manifest.syntheticVoters)) throw new Error('Invalid local phase or count');
      const manifestDigest = await nativeManifestDigest(session.manifest);
      if (!sameBytes(manifestDigest, state.manifestDigest)) throw new Error('Displayed manifest does not match the configured digest');
      const config = pure.configurationDigestFor(state.electionId, state.manifestDigest, state.administrator,
        state.opensAt, state.closesAt, state.candidateCount, state.publicKey, state.coefficientKey, state.trusteeKeys);
      if (!sameBytes(config, state.configurationDigest) || hex(config) !== session.configurationDigest) throw new Error('Configuration changed');
      const sumsA = Array.from({ length: NATIVE_CANDIDATES }, () => pure.nativePublicKey(0n));
      const sumsB = Array.from({ length: NATIVE_CANDIDATES }, () => pure.nativePublicKey(0n));
      const nullifiers = new Set(), receipts = new Set();
      for (let index = 0n; index < state.accepted; index++) {
        const a = state.ballotA.lookup(index), b = state.ballotB.lookup(index), nul = state.nullifiers.lookup(index), receipt = state.ballotReceipts.lookup(index);
        if (nullifiers.has(hex(nul)) || receipts.has(hex(receipt))) throw new Error('Duplicate public identifier');
        nullifiers.add(hex(nul)); receipts.add(hex(receipt));
        if (!sameBytes(receipt, pure.receiptDigest(state.electionId, state.configurationDigest, nul, a, b)) || !state.receipts.member(receipt) || !state.spent.member(nul)) throw new Error('Invalid local receipt');
        for (let candidate = 0; candidate < NATIVE_CANDIDATES; candidate++) {
          sumsA[candidate] = pure.addPoints(sumsA[candidate], a[candidate]);
          sumsB[candidate] = pure.addPoints(sumsB[candidate], b[candidate]);
        }
        await nextFrame();
      }
      if (sumsA.some((point, i) => !pointEqual(point, state.aggregateA[i])) || sumsB.some((point, i) => !pointEqual(point, state.aggregateB[i]))) throw new Error('Aggregate mismatch');
      const totals = recoverNativeTally(emulator, ...session.finalizedPair);
      if (totals.some((value, i) => value !== state.finalizedTotals[i]) || totals.reduce((a, b) => a + b, 0n) !== state.accepted) throw new Error('Tally mismatch');
      output.className = 'verification-result';
      output.textContent = `Election checks passed for ${state.accepted} ballots. Election details, unique ballot receipts, encrypted ballot totals and trustee contributions agree. This checks consistency, not voter identity, fairness or blockchain confirmation.`;
      status('The recorded ballots and results agree.');
      $('native-check-source').value = 'session';
    } catch {
      output.className = 'verification-result failure'; output.textContent = 'The election record did not pass its checks. Do not rely on these results.';
      status('The election checks did not pass.', true);
    }
    output.hidden = false;
  }));
  $('native-reset').addEventListener('click', () => {
    if (busy) return;
    clearInterval(scheduleTimer); scheduleTimer = null;
    session?.emulator.setPrivateState({}); session = null; lastReceipt = null; events.length = 0;
    invalidateImport(); $('native-import-file').value = ''; $('native-import-text').value = ''; $('native-expected-digest').value = '';
    $('native-event-log').replaceChildren(); $('native-vote-form').reset(); $('native-receipt-input').value = ''; $('native-receipt-file').value = '';
    document.querySelectorAll('input[name="native-trustee"]').forEach(input => { input.checked = false; });
    $('native-receipt-check-output').textContent = ''; $('native-check-output').hidden = true;
    $('native-receipt-qr').replaceChildren(); $('native-receipt-hash').textContent = '';
    renderChoices(); showPanel('setup'); render(); status('Election reset. Create another election when you’re ready.');
  });
  renderChoices(); render();
  return { mode: 'generated-contract-emulator', proofGenerated: false, networkTransactionSubmitted: false };
}
