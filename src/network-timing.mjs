/** Display-only projection of the latest indexed ledger. No clock, network,
 * storage, transaction or native-state mutation occurs in this module. */
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const MAX_DATE_SECONDS = 8_640_000_000_000n;
const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false, timeZoneName: 'longOffset',
});
const clockValid = value => typeof value === 'number' && Number.isSafeInteger(value)
  && value >= 0 && value <= MAX_DATE_MILLISECONDS;
const baseNote = 'Countdowns use your device’s clock. Status comes from the last refreshed election record. Use Refresh election record for network changes; reaching zero does not send a transaction.';

export function formatNetworkTimingDate(milliseconds) {
  if (!clockValid(milliseconds)) return Object.freeze({ text: '—', dateTime: null });
  const date = new Date(milliseconds);
  return Object.freeze({ text: dateFormatter.format(date), dateTime: date.toISOString() });
}

export function formatNetworkDuration(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 0) throw new TypeError('Expected nonnegative whole seconds');
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60), remainder = seconds % 60;
  if (days) return `${days}d ${hours}h ${minutes}m ${remainder}s`;
  if (hours) return `${hours}h ${minutes}m ${remainder}s`;
  if (minutes) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function describeNetworkElectionTiming(state, nowMilliseconds) {
  const emptyDate = formatNetworkTimingDate(null);
  const result = { kind: 'empty', phase: 'No election connected', countdown: '—', remainingSeconds: null,
    opens: emptyDate, closes: emptyDate, note: 'Join or create an election to see its schedule.' };
  if (state === null || state === undefined) return Object.freeze(result);
  const invalid = () => Object.freeze({ ...result, kind: 'invalid', phase: 'Schedule unavailable',
    note: 'The indexed schedule or device clock is invalid. Refresh the election record and check your device clock; no countdown can be shown.' });
  if (typeof state !== 'object' || typeof state.keysConfigured !== 'boolean'
    || typeof state.phase !== 'bigint' || state.phase < 0n || state.phase > 3n
    || typeof state.opensAt !== 'bigint' || typeof state.closesAt !== 'bigint'
    || state.opensAt < 0n || state.opensAt >= state.closesAt || state.closesAt > MAX_DATE_SECONDS
    || state.phase !== 0n && !state.keysConfigured || !clockValid(nowMilliseconds)) return invalid();
  result.opens = formatNetworkTimingDate(Number(state.opensAt) * 1000);
  result.closes = formatNetworkTimingDate(Number(state.closesAt) * 1000);
  result.note = baseNote;
  const now = BigInt(Math.floor(nowMilliseconds / 1000));
  const countdown = (deadline, label) => {
    result.remainingSeconds = Number(deadline - now);
    result.countdown = `${label} ${formatNetworkDuration(result.remainingSeconds)} (local estimate)`;
  };
  if (state.phase === 3n) {
    result.kind = 'finalized'; result.phase = 'Results published'; result.countdown = 'Tally finalized';
  } else if (state.phase === 2n) {
    result.kind = 'closed'; result.phase = 'Voting closed — awaiting tally'; result.countdown = 'Reveal the tally after two trustee contributions';
  } else if (state.phase === 1n && now < state.opensAt) {
    result.kind = 'clock-mismatch'; result.phase = 'Voting is open'; result.countdown = 'Check the device clock and refresh';
  } else if (!state.keysConfigured && now >= state.opensAt) {
    result.kind = 'setup-expired'; result.phase = 'Setup incomplete — opening time passed'; result.countdown = 'Trustee keys were not registered';
    result.note = 'The local clock is past the setup deadline, but the indexed record has no registered trustee keys. Refresh and check your device clock; voting has not opened. ' + baseNote;
  } else if (now < state.opensAt) {
    result.kind = state.keysConfigured ? 'planned' : 'setup-pending';
    result.phase = state.keysConfigured ? 'Planned — waiting to open' : 'Planned — trustee setup required';
    countdown(state.opensAt, 'Scheduled opening in');
  } else if (now >= state.closesAt) {
    result.kind = 'awaiting-close'; result.phase = 'Voting deadline reached — awaiting closing transaction';
    result.countdown = 'No voting time remaining (local estimate)';
  } else if (state.phase === 0n) {
    result.kind = 'awaiting-open'; result.phase = 'Waiting for opening transaction';
    countdown(state.closesAt, 'Scheduled closing in');
  } else {
    result.kind = 'open'; result.phase = 'Voting is open';
    countdown(state.closesAt, 'Voting time left');
  }
  if (result.kind === 'clock-mismatch' || state.phase >= 2n && now < state.closesAt) {
    result.note = 'The device clock and indexed phase disagree. No countdown is shown; refresh the record and check your clock. ' + baseNote;
  }
  return Object.freeze(result);
}
