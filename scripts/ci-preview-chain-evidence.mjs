/** Strict public chain metadata only; validation does not contact a network. */
import { validatePreviewChainIdentity } from '../contracts/native/public-testnet.mjs';

const FUNDING_CHECKPOINTS = Object.freeze([
  'before-wallet-creation', 'before-funding-request', 'before-dust-registration',
  ...Array(9).fill('before-application-operation'),
]);
const DIAGNOSTIC_CHECKPOINTS = Object.freeze(['before-wallet-creation', 'before-fundless-proof']);
function requireValue(value) { if (!value) throw new Error('Public chain evidence validation failed'); }
function plain(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
}
export function validateChainIdentity(value, expectedIdentity) {
  try {
    const identity = validatePreviewChainIdentity(value);
    if (expectedIdentity !== undefined) {
      const expected = validatePreviewChainIdentity(expectedIdentity);
      requireValue(identity.protocolVersion === expected.protocolVersion);
    }
    return identity;
  } catch { throw new Error('Public chain evidence validation failed'); }
}
export function validateChainCheckpoints(record, { mode, completed = false } = {}) {
  requireValue(mode === 'funded' || mode === 'diagnostic');
  const hasIdentity = Object.hasOwn(record, 'chainIdentity');
  const hasCheckpoints = Object.hasOwn(record, 'chainCheckpoints');
  requireValue(hasIdentity === hasCheckpoints);
  if (!hasIdentity) { requireValue(!completed); return; }
  validateChainIdentity(record.chainIdentity);
  const checkpoints = record.chainCheckpoints;
  const expected = mode === 'funded' ? FUNDING_CHECKPOINTS : DIAGNOSTIC_CHECKPOINTS;
  requireValue(Array.isArray(checkpoints) && checkpoints.length > 0 && checkpoints.length <= expected.length
    && (!completed || checkpoints.length === expected.length));
  let previous = -Infinity;
  for (const [index, point] of checkpoints.entries()) {
    plain(point);
    const operation = expected[index] === 'before-application-operation';
    const fields = operation ? ['checkpoint', 'checkedAt', 'operationOrdinal'] : ['checkpoint', 'checkedAt'];
    requireValue(Object.keys(point).length === fields.length && fields.every(key => Object.hasOwn(point, key))
      && point.checkpoint === expected[index] && (!operation || point.operationOrdinal === index - 2)
      && typeof point.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(point.checkedAt));
    const time = Date.parse(point.checkedAt);
    requireValue(Number.isFinite(time) && new Date(time).toISOString() === point.checkedAt && time >= previous);
    previous = time;
  }
}
