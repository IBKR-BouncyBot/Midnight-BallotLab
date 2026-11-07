/** Strict public function-entry evidence only; no proof-completion attestation. */
import { LACE_PROOF_COVERAGE_SOURCE } from './lace-proof-coverage.mjs';

const failures = new Set(['proof-coverage-command-failed', 'proof-coverage-projection-invalid',
  'proof-coverage-window-invalid', 'proof-coverage-entry-unobserved', 'proof-coverage-cleanup-failed']);
function requireValue(value) { if (!value) throw new Error('Public proof-entry evidence validation failed'); }
function exactObject(value, fields) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const keys = Reflect.ownKeys(value);
  requireValue(keys.length === fields.length && keys.every(key => typeof key === 'string' && fields.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
}
function integer(value, maximum) { return Number.isSafeInteger(value) && value >= 0 && value <= maximum; }

export function validateWalletProofExecution(value, { completed = false } = {}) {
  requireValue(typeof completed === 'boolean');
  exactObject(value, ['schema', 'source', 'observed', 'status', 'failureCategory', 'activeOrdinal', 'operations',
    'functionEntryOnly', 'proofCompletionAttested', 'privateInputsInspected', 'runtimeEvaluationUsed', 'executionPaused']);
  requireValue(value.schema === 'midnight-ballot-lab/lace-proof-entry-observation/v1'
    && typeof value.observed === 'boolean' && ['armed', 'observed', 'failed', 'closed'].includes(value.status)
    && (value.failureCategory === null || failures.has(value.failureCategory))
    && value.functionEntryOnly === true && value.proofCompletionAttested === false
    && value.privateInputsInspected === false && value.runtimeEvaluationUsed === false && value.executionPaused === false);
  exactObject(value.source, Object.keys(LACE_PROOF_COVERAGE_SOURCE));
  requireValue(Object.entries(LACE_PROOF_COVERAGE_SOURCE).every(([key, expected]) => value.source[key] === expected));
  requireValue(Array.isArray(value.operations) && value.operations.length <= 9);
  requireValue(Reflect.ownKeys(value.operations).length === value.operations.length + 1);
  for (let index = 0; index < value.operations.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.operations, String(index));
    requireValue(descriptor && Object.hasOwn(descriptor, 'value'));
    const operation = descriptor.value;
    exactObject(operation, ['ordinal', 'entryCalls', 'matchedFunctions', 'workerSessions']);
    requireValue(operation.ordinal === index + 1 && integer(operation.entryCalls, 1_000_000)
      && integer(operation.matchedFunctions, 8) && integer(operation.workerSessions, 8)
      && operation.matchedFunctions <= operation.workerSessions
      && (operation.entryCalls === 0 || operation.matchedFunctions > 0));
  }
  requireValue(value.activeOrdinal === null || (value.activeOrdinal === value.operations.length + 1
    && integer(value.activeOrdinal, 9) && value.activeOrdinal > 0));
  requireValue((value.status === 'failed') === (value.failureCategory !== null));
  requireValue(value.observed === (value.status === 'observed'));
  if (value.status === 'closed') requireValue(value.activeOrdinal === null);
  if (completed || value.observed) {
    requireValue(value.observed === true && value.status === 'observed' && value.failureCategory === null
      && value.activeOrdinal === null && value.operations.length === 9
      && value.operations.every(operation => operation.entryCalls > 0
        && operation.matchedFunctions > 0 && operation.workerSessions > 0));
  }
}
