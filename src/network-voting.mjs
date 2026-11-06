/** Display/readiness only. Inputs come from the last loaded native ledger and
 * local native key checks. This module never receives a key, changes a ledger,
 * reads the clock, connects a wallet, polls a service or sends a transaction. */
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const MAX_DATE_SECONDS = 8_640_000_000_000n;
const result = (kind, message, actionHref, actionLabel, canChoose = false, canCast = false) =>
  Object.freeze({ kind, message, canChoose, canCast, actionHref, actionLabel });
const unavailable = () => result('unavailable',
  'Voting readiness could not be checked from the current record. Refresh the election record and check your device clock before trying again.',
  '#network-read', 'Refresh election record');
const triState = value => value === null || typeof value === 'boolean';

export function describeNetworkVoting({ walletConnected = false, contractConnected = false,
  configurationVerified = false, state = null, busy = false, pendingReceipt = false,
  voterKeyValid = false, voterRegistered = null, voterSpent = null,
  selectedChoice = '', nowMilliseconds } = {}) {
  try {
    if (![walletConnected, contractConnected, configurationVerified, busy, pendingReceipt, voterKeyValid]
      .every(value => typeof value === 'boolean') || !triState(voterRegistered) || !triState(voterSpent)
      || typeof selectedChoice !== 'string') return unavailable();
    if (busy) return result('busy', 'Wait for the current action to finish before voting.', null, null);
    if (!walletConnected) return result('wallet-required',
      'Connect your wallet first. Then create or join the election you want to vote in.', '#connect-heading', 'Connect wallet');
    if (!contractConnected) return result('election-required',
      'Create or join an election first. A wallet connection alone does not open an election for voting.', '#contract-heading', 'Set up or join election');
    if (pendingReceipt) return result('pending',
      'A previous vote attempt has an unresolved outcome. Check the pending vote and your wallet before another attempt; do not assume it was submitted or rejected.',
      '#network-recover-receipt', 'Check pending vote');
    if (!state || typeof state.phase !== 'bigint' || state.phase < 0n || state.phase > 3n
      || typeof state.keysConfigured !== 'boolean' || state.phase !== 0n && !state.keysConfigured
      || typeof state.candidateCount !== 'bigint' || state.candidateCount < 2n || state.candidateCount > 5n
      || typeof state.opensAt !== 'bigint' || typeof state.closesAt !== 'bigint'
      || state.opensAt < 0n || state.opensAt >= state.closesAt || state.closesAt > MAX_DATE_SECONDS
      || !Number.isSafeInteger(nowMilliseconds) || nowMilliseconds < 0 || nowMilliseconds > MAX_DATE_MILLISECONDS
      || typeof state.enrolled?.size !== 'function') return unavailable();
    const enrolled = state.enrolled.size();
    if (typeof enrolled !== 'bigint' || enrolled < 0n || enrolled > 1024n) return unavailable();
    const now = BigInt(Math.floor(nowMilliseconds / 1000));
    if (!state.keysConfigured) return now >= state.opensAt
      ? result('setup-expired', 'The device clock is past the setup deadline, but trustee keys are not registered in the last refreshed record. Refresh and check the clock; this election cannot open without its trustee setup.',
        '#network-read', 'Refresh election record')
      : result('setup-required', 'Register the election’s trustee keys before voting. Then register voters before the scheduled opening time.',
        '#network-generate-dealer', 'Set up trustee keys');
    if (!configurationVerified) return result('configuration-unverified',
      'The election’s configuration has not been verified in this session. Refresh its record or join again using the saved election details.',
      '#network-read', 'Refresh election record');
    if (state.phase === 3n) return result('finalized', 'This election’s results are published in the last refreshed record. Voting is finished; check the results or your receipt.',
      '#check-heading', 'Check results and receipts');
    if (state.phase === 2n) return result('closed', 'Voting is closed in the last refreshed record. Continue to trustee contributions and the tally, or check your receipt.',
      '#tally-heading', 'Reveal results');
    if (now >= state.closesAt) return result('deadline-reached',
      'The scheduled voting deadline has passed according to your device’s clock. Refresh the election record. A closing transaction is still required before the tally can be revealed.',
      '#network-read', 'Refresh election record');
    if (state.phase === 0n && now < state.opensAt) return result('scheduled',
      'Voting has not opened. Register each voter before the scheduled opening time, then choose Open voting when that time arrives. The schedule estimate uses your device’s clock.',
      '#network-voter', 'Register voters');
    if (state.phase === 0n && enrolled === 0n) return result('enrollment-missed',
      'No voters are registered in the last refreshed record, and your device’s clock is past the registration deadline. Refresh and check the clock. If confirmed, this election cannot open; create a new election with time to register voters.',
      '#network-read', 'Refresh election record');
    if (state.phase === 0n) return result('awaiting-open',
      'Your device’s clock has reached the scheduled opening time, but the last refreshed record still shows voting unopened. Choose Open voting, or refresh if someone else has already opened it.',
      '#network-open', 'Open voting');
    if (now < state.opensAt) return result('clock-mismatch',
      'The record shows voting open, but your device’s clock is before its opening time. Refresh the record and check your clock before voting.',
      '#network-read', 'Refresh election record');
    if (!voterKeyValid) return result('key-required',
      'Load the voter key that was registered for this election. It must be a valid 64-character hexadecimal key.',
      '#network-import-voter', 'Load voter key');
    if (voterRegistered === null || voterSpent === null || !voterRegistered && voterSpent) return unavailable();
    if (!voterRegistered) return result('not-registered',
      'This key is not registered in the last refreshed election record. Load the key registered before voting opened; generating a new key does not register it.',
      '#network-import-voter', 'Load registered voter key');
    if (voterSpent) return result('already-voted',
      'The last refreshed record shows a vote already accepted for this voter key. This key cannot vote again in this election. Check its saved receipt instead.',
      '#network-verification-heading', 'Check receipt');
    if (!/^[0-4]$/.test(selectedChoice) || BigInt(selectedChoice) >= state.candidateCount) return result(
      selectedChoice === '' ? 'choose' : 'choice-invalid',
      selectedChoice === '' ? 'This voter key is registered and unused in the last refreshed record. Choose one option to enable Submit vote.'
        : 'Choose one of this election’s available options before submitting your vote.',
      '#network-selection', 'Choose an option', true);
    return result('ready',
      'This voter key is registered and unused in the last refreshed record. Submit your selected vote and approve the request in Lace. The contract checks eligibility and the deadline again.',
      '#network-cast', 'Submit vote', true, true);
  } catch { return unavailable(); }
}
