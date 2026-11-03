import {
  SCHEMAS, setupElection, encryptBallot, verifyBallot, createDecryptionShare,
  finalizeElection, verifyElectionRecord, receiptForBallot, verifyReceipt,
  hashManifest, hashRecord,
} from './protocol.mjs';
import { qrSvg } from './qr.mjs';
import { BROWSER_JSON_LIMIT, decodeJsonUtf8, parseStrictJson } from './json.mjs';

// Research demonstration only. All private demo material stays in this closure.
// No cookies, browser storage, service workers, analytics, or network API calls.
const $ = id => document.getElementById(id);
const state = {
  phase: 'empty', manifest: null, manifestHash: null, recordHash: null,
  credentials: [], trustees: [], ballots: [], usedKeys: new Set(),
  receipt: null, record: null, loadedRecord: null, lastVerification: null,
  busy: false, step: 'setup', events: [],
};
const tick = () => new Promise(resolve => setTimeout(resolve, 40));
const jsonCopy = value => JSON.parse(JSON.stringify(value));
const truncate = value => `${value.slice(0, 14)}…${value.slice(-10)}`;
const safeName = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'election';

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showStatus(message, type = 'success') {
  const area = $('global-status');
  area.hidden = !message;
  area.className = `global-status ${type}`;
  area.textContent = message;
}

function showStep(step) {
  state.step = step;
  document.querySelectorAll('[data-panel]').forEach(panel => { panel.hidden = panel.dataset.panel !== step; });
  document.querySelectorAll('[data-step]').forEach(button => {
    const selected = button.dataset.step === step;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
}

function addEvent(title, detail = '') {
  state.events.unshift({ title, detail, date: new Date() });
  state.events = state.events.slice(0, 8);
  $('event-log').replaceChildren(...state.events.map(event => {
    const item = node('div', 'event-entry');
    item.append(node('strong', '', event.title));
    if (event.detail) item.append(node('span', '', event.detail));
    const time = node('time', '', event.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    time.dateTime = event.date.toISOString();
    item.append(time);
    return item;
  }));
}

function syncUi() {
  const exists = !!state.manifest;
  const isOpen = state.phase === 'open';
  const isClosed = state.phase === 'closed';
  const final = state.phase === 'finalized';
  $('metric-voters').textContent = exists ? String(state.credentials.length) : '—';
  $('metric-ballots').textContent = String(state.ballots.length);
  $('metric-phase').textContent = { empty: 'Not created', open: 'Voting open', closed: 'Voting closed', finalized: 'Finalized locally' }[state.phase];
  $('notebook-election-id').textContent = state.manifest?.electionId ?? 'Not created';
  $('setup-form').hidden = exists;
  $('setup-complete').hidden = !exists;
  $('vote-empty').hidden = exists;
  $('vote-form').hidden = !isOpen;
  $('vote-closed').hidden = !isClosed && !final;
  $('receipt-panel').hidden = !state.receipt;
  $('tally-empty').hidden = exists && state.ballots.length > 0;
  $('tally-controls').hidden = !exists || state.ballots.length === 0 || final;
  $('results-panel').hidden = !final;
  $('create-election').disabled = state.busy || exists;
  $('cast-ballot').disabled = state.busy || !isOpen || state.usedKeys.size === state.credentials.length;
  $('close-election').disabled = state.busy || !isOpen || !state.ballots.length;
  $('trustee-fieldset').disabled = state.busy || !isClosed;
  $('finalize-election').disabled = state.busy || !isClosed || document.querySelectorAll('input[name="trustee"]:checked').length < 2;
  $('verify-current').disabled = state.busy || !state.record;
  $('verify-imported').disabled = state.busy || !state.loadedRecord;
  $('load-current-record').disabled = state.busy || !state.record;
  $('tamper-test').disabled = state.busy || !state.loadedRecord;
  $('check-receipt').disabled = state.busy || !state.loadedRecord;
  $('reset-experiment').disabled = state.busy;
  $('record-file').disabled = state.busy;
  $('receipt-file').disabled = state.busy;
  for (const id of ['expected-manifest', 'expected-record', 'receipt-input']) $(id).disabled = state.busy;
  $('voter-select').disabled = state.busy;
  document.querySelectorAll('input[name="candidate"]').forEach(input => { input.disabled = state.busy; });
  $('close-heading').textContent = isClosed ? 'The ballot set is frozen.' : 'Ready to close voting?';
  $('close-description').textContent = isClosed ? 'Select at least two trustees to generate decryption shares and publish the result.' : 'Closing freezes the accepted ballot set. You cannot add more ballots to this experiment afterward.';
  $('close-election').textContent = isClosed ? 'Voting closed' : 'Close voting';
  document.body.classList.toggle('busy', state.busy);
  document.querySelector('.work-main')?.setAttribute('aria-busy', String(state.busy));
}

async function run(message, operation) {
  if (state.busy) return;
  state.busy = true;
  showStatus(message, 'working');
  syncUi();
  try {
    await tick();
    await operation();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    state.busy = false;
    syncUi();
  }
}

function download(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = node('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderCredentials() {
  const select = $('voter-select');
  select.replaceChildren(...state.credentials.map((credential, index) => {
    const used = state.usedKeys.has(credential.publicKey);
    const option = node('option', '', `${credential.alias}${used ? ' · already voted' : ''}`);
    option.value = String(index);
    option.disabled = used;
    return option;
  }));
  const next = state.credentials.findIndex(credential => !state.usedKeys.has(credential.publicKey));
  select.value = next < 0 ? '' : String(next);
  if (next < 0) {
    const option = node('option', '', 'All demo credentials have voted');
    option.value = '';
    option.selected = true;
    select.prepend(option);
  }
}

function renderCandidates() {
  $('candidate-options').replaceChildren(...state.manifest.candidates.map((candidate, index) => {
    const label = node('label', 'candidate-card');
    const input = node('input');
    input.type = 'radio'; input.name = 'candidate'; input.value = String(index); input.required = true;
    label.append(input, node('span', '', candidate), node('span', 'candidate-letter', String.fromCharCode(65 + index)));
    return label;
  }));
}

function renderTrustees() {
  $('trustee-options').replaceChildren(...state.trustees.map(trustee => {
    const label = node('label', 'trustee-card');
    const input = node('input');
    input.type = 'checkbox'; input.name = 'trustee'; input.value = String(trustee.index); input.checked = trustee.index < 3;
    input.addEventListener('change', syncUi);
    label.append(input, node('span', '', `Trustee ${trustee.index}`), node('small', '', truncate(trustee.publicKey)));
    return label;
  }));
}

function renderBallots() {
  $('ballot-list').replaceChildren(...state.ballots.map((ballot, index) => {
    const item = node('div', 'ballot-item');
    const heading = node('div', 'ballot-item-head');
    heading.append(node('span', '', `Ballot ${String(index + 1).padStart(2, '0')}`), node('span', '', 'Encrypted'));
    item.append(heading, node('code', '', ballot.id));
    return item;
  }));
}

function receiptCode(receipt) { return `mbl1:${receipt.electionHash}:${receipt.ballotId}`; }

function renderReceipt() {
  $('receipt-id').textContent = state.receipt.ballotId;
  $('receipt-qr').innerHTML = qrSvg(receiptCode(state.receipt), { scale: 4 });
}

function renderResults() {
  const count = state.record.ballots.length;
  $('results-count').textContent = `${count} ballot${count === 1 ? '' : 's'} · aggregate only`;
  $('result-bars').replaceChildren(...state.record.tally.map((total, index) => {
    const row = node('div', 'result-row');
    const heading = node('div', 'result-label');
    heading.append(node('span', '', state.record.manifest.candidates[index]), node('strong', '', `${total} / ${count}`));
    const track = node('div', 'result-track');
    const fill = node('div', 'result-fill');
    fill.style.width = `${count ? (total / count) * 100 : 0}%`;
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${state.record.manifest.candidates[index]}: ${total} votes`);
    track.append(fill); row.append(heading, track); return row;
  }));
}

function verificationOptions() {
  const options = {};
  for (const [id, name] of [['expected-manifest', 'expectedManifestHash'], ['expected-record', 'expectedRecordHash']]) {
    const value = $(id).value.trim();
    if (value && !/^[0-9a-f]{64}$/.test(value)) throw new Error('Expected fingerprints must contain exactly 64 lowercase hexadecimal characters.');
    if (value) options[name] = value;
  }
  return options;
}

function invalidateReceiptCheck() {
  $('receipt-check-result').textContent = '';
  $('receipt-check-result').className = 'inline-status';
}

function invalidateVerification() {
  state.lastVerification = null;
  $('verification-result').hidden = true;
  $('tamper-panel').hidden = true;
  invalidateReceiptCheck();
}

function renderVerification(result, { tampered = false } = {}) {
  const area = $('verification-result');
  area.hidden = false;
  area.className = `verification-result${result.valid || (tampered && !result.valid) ? '' : ' failure'}`;
  area.replaceChildren();
  if (tampered) {
    area.append(node('h3', '', result.valid ? 'Unexpected: tampered copy passed' : 'Tampered copy rejected'));
    area.append(node('p', '', result.valid ? 'The tamper test failed. Do not trust this implementation.' : 'Increasing a published total invalidated the record. Your original public record was not changed.'));
    if (result.valid) area.classList.add('failure');
  } else {
    area.append(node('h3', '', result.valid ? 'Mathematical checks passed' : 'Record rejected'));
    if (result.valid) {
      area.append(node('p', '', `${result.ballotCount} encrypted ballot${result.ballotCount === 1 ? '' : 's'} checked. Aggregate tally: ${result.tally.map((value, index) => `${state.loadedRecord.manifest.candidates[index]} ${value}`).join(' · ')}.`));
      const auth = result.anchored
        ? 'Both supplied fingerprints match. Their trustworthiness still depends on where you obtained them; this is not a live blockchain check.'
        : 'This record is mathematically valid. Its election identity and final accepted ballot set are not both authenticated by independently supplied fingerprints.';
      area.append(node('p', 'auth-note', auth));
    }
  }
  const checks = node('ul', 'verification-checks');
  for (const check of result.checks) {
    const item = node('li');
    item.append(node('span', check.valid ? 'check-pass' : 'check-fail', check.valid ? '✓' : '×'), node('span', '', check.name));
    checks.append(item);
  }
  area.append(checks);
  if (result.errors.length) {
    const errors = node('ul', 'verification-errors');
    result.errors.forEach(error => errors.append(node('li', '', error)));
    area.append(errors);
  }
  if (result.valid) {
    area.append(node('p', '', 'Final-record fingerprint'), node('code', 'fingerprint', result.recordHash));
  }
  if (!tampered) $('tamper-panel').hidden = !result.valid;
}

async function checkLoadedRecord() {
  invalidateVerification();
  if (!state.loadedRecord) throw new Error('Import a final public election record first.');
  const result = await verifyElectionRecord(state.loadedRecord, verificationOptions());
  state.lastVerification = result;
  renderVerification(result);
  showStatus(result.valid ? 'Public-record checks completed. Review the fingerprint authentication status below.' : 'The imported record failed verification.', result.valid ? 'success' : 'error');
  addEvent(result.valid ? 'Public record verified' : 'Verification rejected a record', 'No private keys used');
}

async function loadCurrentRecord() {
  if (!state.record) throw new Error('Finalize this experiment before loading its public record.');
  state.loadedRecord = jsonCopy(state.record);
  $('expected-manifest').value = state.manifestHash;
  $('expected-record').value = state.recordHash;
  invalidateVerification();
  showStep('verify');
  syncUi();
}

$('setup-form').addEventListener('submit', event => {
  event.preventDefault();
  run('Generating synthetic voter credentials and trustee shares…', async () => {
    if (state.phase !== 'empty') throw new Error('Reset the experiment before creating another election.');
    const candidates = $('candidate-list').value.split('\n').map(value => value.trim()).filter(Boolean);
    if (candidates.length < 2 || candidates.length > 5 || new Set(candidates).size !== candidates.length) throw new Error('Enter between two and five distinct choices, one per line.');
    if (candidates.some(value => value.length > 80)) throw new Error('Each choice must contain no more than 80 characters.');
    const voterCount = Number($('voter-count').value);
    if (!Number.isSafeInteger(voterCount) || voterCount < 2 || voterCount > 20) throw new Error('Choose between 2 and 20 demo voters.');
    const title = $('election-title').value.trim();
    if (!title) throw new Error('Enter a name for this election.');
    const election = await setupElection({ id: `demo-${crypto.randomUUID()}`, title, candidates, voterCount, maxBallots: voterCount });
    state.manifest = election.manifest;
    state.credentials = election.credentials;
    state.trustees = election.trustees;
    state.manifestHash = await hashManifest(state.manifest);
    state.phase = 'open';
    $('setup-summary').textContent = `${title} · ${candidates.length} choices · ${voterCount} synthetic credentials · 2-of-3 trustee threshold.`;
    $('manifest-fingerprint').textContent = state.manifestHash;
    renderCandidates(); renderCredentials(); renderTrustees();
    addEvent('Election opened locally', `${voterCount} synthetic credentials`);
    showStatus('The election is ready. Cast a ballot using a synthetic credential.');
  });
});

$('vote-form').addEventListener('submit', event => {
  event.preventDefault();
  const credentialIndex = Number($('voter-select').value);
  const selected = document.querySelector('input[name="candidate"]:checked');
  if (!selected) { showStatus('Select one option before casting.', 'error'); return; }
  const candidateIndex = Number(selected.value);
  run('Encrypting the ballot and generating real validity proofs…', async () => {
    if (state.phase !== 'open') throw new Error('Voting is not open.');
    const credential = state.credentials[credentialIndex];
    if (!credential || state.usedKeys.has(credential.publicKey)) throw new Error('This demo credential has already voted or is unavailable.');
    const ballot = await encryptBallot(state.manifest, candidateIndex, credential);
    showStatus('Checking ballot proofs before accepting it…', 'working');
    await tick();
    const check = await verifyBallot(state.manifest, ballot);
    if (!check.valid) throw new Error(`Ballot rejected: ${check.errors.join('; ')}`);
    const receipt = await receiptForBallot(state.manifest, ballot);
    state.ballots.push(ballot);
    state.usedKeys.add(credential.publicKey);
    state.receipt = receipt;
    document.querySelectorAll('input[name="candidate"]').forEach(input => { input.checked = false; });
    renderCredentials(); renderBallots(); renderReceipt();
    addEvent('Encrypted ballot accepted', truncate(ballot.id));
    showStatus('Ballot accepted locally. Save its receipt before casting another ballot.');
  });
});

$('close-election').addEventListener('click', () => {
  if (state.busy || state.phase !== 'open' || !state.ballots.length) return;
  state.phase = 'closed';
  state.ballots = Object.freeze([...state.ballots]);
  document.querySelectorAll('input[name="candidate"]').forEach(input => { input.checked = false; });
  addEvent('Voting closed', `${state.ballots.length} accepted ballots frozen`);
  showStatus('Voting is closed. Choose at least two trustees to publish the aggregate result.');
  syncUi();
});

$('finalize-election').addEventListener('click', () => run('Validating the frozen ballot set and preparing trustee shares…', async () => {
  if (state.phase !== 'closed') throw new Error('Close voting before finalizing.');
  const indexes = [...document.querySelectorAll('input[name="trustee"]:checked')].map(input => Number(input.value));
  if (indexes.length < 2) throw new Error('At least two trustee shares are required.');
  const shares = [];
  for (const index of indexes) {
    showStatus(`Generating and proving trustee ${index}’s decryption share…`, 'working');
    await tick();
    shares.push(await createDecryptionShare(state.manifest, state.ballots, state.trustees.find(trustee => trustee.index === index)));
  }
  showStatus('Combining verified shares and checking the final election record…', 'working');
  await tick();
  const record = await finalizeElection(state.manifest, state.ballots, shares);
  const check = await verifyElectionRecord(record, { expectedManifestHash: state.manifestHash });
  if (!check.valid) throw new Error(`Final record rejected: ${check.errors.join('; ')}`);
  state.record = record;
  state.recordHash = await hashRecord(record);
  state.phase = 'finalized';
  renderResults();
  addEvent('Aggregate tally finalized', `${shares.length} verified trustee shares`);
  showStatus('The aggregate result is published locally. Export its public record or verify it below.');
}));

$('download-manifest').addEventListener('click', () => {
  if (state.manifest) download(`${safeName(state.manifest.title)}-manifest.json`, state.manifest);
});
$('download-receipt').addEventListener('click', () => {
  if (state.receipt) download(`ballot-receipt-${state.receipt.ballotId.slice(0, 12)}.json`, state.receipt);
});
$('copy-receipt').addEventListener('click', async () => {
  if (!state.receipt) return;
  try {
    await navigator.clipboard.writeText(receiptCode(state.receipt));
    showStatus('Receipt code copied. It contains no ballot choice or private key.');
  } catch {
    invalidateReceiptCheck();
    $('receipt-input').value = receiptCode(state.receipt);
    showStatus('Clipboard access was unavailable. The code is in the receipt-check field under Verify; you can also save the receipt file.');
  }
});
$('export-record').addEventListener('click', () => {
  if (state.record) download(`${safeName(state.manifest.title)}-public-record.json`, state.record);
});
$('verify-current').addEventListener('click', () => run('Checking the public record without private keys…', async () => { await loadCurrentRecord(); await checkLoadedRecord(); }));
$('load-current-record').addEventListener('click', () => run('Loading this experiment’s public record…', async () => { await loadCurrentRecord(); showStatus('The record is loaded with fingerprints retained from this tab. Click Verify to check it.'); }));
$('verify-imported').addEventListener('click', () => run('Checking all encrypted ballots, aggregation and decryption proofs…', checkLoadedRecord));

async function readJsonFile(file) {
  if (!file) throw new Error('Choose a JSON file.');
  if (file.size > BROWSER_JSON_LIMIT) throw new Error('This browser demonstrator accepts files up to 8 MB.');
  const text = decodeJsonUtf8(new Uint8Array(await file.arrayBuffer()));
  return parseStrictJson(text);
}

$('record-file').addEventListener('change', () => run('Reading the public election record…', async () => {
  state.loadedRecord = null;
  invalidateVerification();
  $('expected-manifest').value = '';
  $('expected-record').value = '';
  const record = await readJsonFile($('record-file').files[0]);
  state.loadedRecord = record;
  showStatus('Record loaded. Add independently obtained fingerprints if available, then run verification.');
}));

$('tamper-test').addEventListener('click', () => run('Changing a total in a copy, then checking its proofs…', async () => {
  if (!state.loadedRecord || !Array.isArray(state.loadedRecord.tally)) throw new Error('First verify a complete election record.');
  const corrupted = jsonCopy(state.loadedRecord);
  corrupted.tally[0] += 1;
  // Omit the record hash here: we specifically want the mathematical tally check
  // to reject corruption, not merely compare a differing file fingerprint.
  const result = await verifyElectionRecord(corrupted, { expectedManifestHash: await hashManifest(corrupted.manifest) });
  renderVerification(result, { tampered: true });
  addEvent(result.valid ? 'Tamper test unexpectedly passed' : 'Tampered total rejected', 'Original record unchanged');
  showStatus(result.valid ? 'Unexpected result: the corrupted record passed. Do not trust this implementation.' : 'Tamper test passed: the modified total was rejected by the verifier.', result.valid ? 'error' : 'success');
}));

function parseReceipt(value, record) {
  const input = value.trim();
  const match = /^mbl1:([0-9a-f]{64}):([0-9a-f]{64})$/.exec(input);
  if (match) return { schema: SCHEMAS.receipt, electionId: record.manifest?.electionId, electionHash: match[1], ballotId: match[2] };
  try { return parseStrictJson(input); }
  catch (error) { throw new Error(`Invalid receipt: ${error.message}. Paste strict JSON or a code in the form mbl1:electionFingerprint:ballotFingerprint.`); }
}

$('check-receipt').addEventListener('click', () => run('Checking the receipt against the finalized public record…', async () => {
  invalidateReceiptCheck();
  if (!state.loadedRecord) throw new Error('Load a final public election record before checking a receipt.');
  const receipt = parseReceipt($('receipt-input').value, state.loadedRecord);
  const result = await verifyReceipt(state.loadedRecord, receipt, verificationOptions());
  const target = $('receipt-check-result');
  target.className = `inline-status ${result.valid && result.included ? 'pass' : 'fail'}`;
  target.textContent = result.valid && result.included
    ? `Receipt matches an encrypted ballot in this verified record.${result.anchored ? ' Both supplied record fingerprints match.' : ' The record is not authenticated against both independently supplied fingerprints.'} No ballot choice was revealed.`
    : `Receipt check failed: ${result.errors.join('; ') || 'The ballot was not included.'}`;
  showStatus(result.valid && result.included ? 'Receipt inclusion check completed.' : 'The receipt did not pass verification.', result.valid && result.included ? 'success' : 'error');
}));

$('receipt-file').addEventListener('change', () => run('Reading the ballot receipt…', async () => {
  invalidateReceiptCheck();
  $('receipt-input').value = '';
  const receipt = await readJsonFile($('receipt-file').files[0]);
  $('receipt-input').value = JSON.stringify(receipt, null, 2);
  showStatus('Receipt loaded. Click Check inclusion to verify it against the loaded record.');
}));

for (const id of ['expected-manifest', 'expected-record']) $(id).addEventListener('input', invalidateVerification);
$('receipt-input').addEventListener('input', invalidateReceiptCheck);

document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => showStep(button.dataset.step)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showStep(button.dataset.go)));
$('limits-toggle').addEventListener('click', () => {
  const show = $('limitations').hidden;
  $('limitations').hidden = !show;
  $('limits-toggle').setAttribute('aria-expanded', String(show));
});
$('reset-experiment').addEventListener('click', () => {
  if (state.busy) return;
  if (state.manifest && !confirm('Reset this local experiment? Private demo credentials and trustee shares will be lost. Export any public records or receipts you want to retain first.')) return;
  location.reload();
});

if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
  showStatus('This application requires a secure browser context with Web Crypto. Open the hosted HTTPS page or a localhost development server.', 'error');
  state.busy = true;
}
syncUi();
