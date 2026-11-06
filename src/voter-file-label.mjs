/** Private, session-only filename convenience. Labels are not voter identities
 * or receipt evidence. This module does not persist or serialize the mapping. */
import { normalizePrivateKey } from './private-key.mjs';

const MAX_TIMESTAMP_MILLISECONDS = 8_640_000_000_000_000;

function counterLabel(value) {
  if (typeof value !== 'string' || !/^[0-9]{6,16}$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    && String(number).padStart(6, '0') === value;
}

function validLabel(value) {
  if (typeof value !== 'string' || value.length > 33) return false;
  if (counterLabel(value)) return true;
  const parts = value.split('-');
  if (parts.length !== 2 || !/^[1-9][0-9]{0,15}$/.test(parts[0]) || !counterLabel(parts[1])) return false;
  const timestamp = Number(parts[0]);
  return Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= MAX_TIMESTAMP_MILLISECONDS;
}

/** Returns null for unknown or arbitrary labels; callers choose a neutral fallback. */
export function receiptFilenameForLabel(label) {
  return validLabel(label) ? `midnight-voter-${label}-receipt.json` : null;
}

export function createVoterFileLabels() {
  const labels = new Map();
  const remember = (key, label) => {
    const normalized = normalizePrivateKey(key);
    if (!validLabel(label)) throw new TypeError('Invalid voter file label');
    if (!labels.has(normalized)) labels.set(normalized, label);
    return labels.get(normalized);
  };
  return Object.freeze({
    remember,
    import(key, filename) {
      const normalized = normalizePrivateKey(key);
      const match = typeof filename === 'string' && filename.length <= 80
        ? /^midnight-voter-key-([0-9-]+)\.private\.txt$/.exec(filename) : null;
      if (match && validLabel(match[1])) return remember(normalized, match[1]);
      return labels.get(normalized) ?? null;
    },
    lookup(key) { return labels.get(normalizePrivateKey(key)) ?? null; },
    clear() { labels.clear(); },
  });
}

