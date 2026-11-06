/** Public progress projection only. Never read the runner's private output. */
import { constants } from 'node:fs';
import { open, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJsonUtf8, parseStrictJson } from '../src/json.mjs';

export const LACE_PROGRESS_STAGES = Object.freeze([
  'ci-prerequisites', 'read-signed-wallet-public-service-configuration',
  'start-genuine-extension', 'observe-normal-wallet-public-service-configuration',
  'reload-wallet-before-creation-for-public-configuration', 'create-fresh-test-wallet',
  'close-wallet-views-for-normal-configuration-activation', 'wait-normal-wallet-worker-close',
  'reopen-wallet-after-normal-configuration-activation', 'wait-current-wallet-service-labels',
  'wait-normal-wallet-replacement-before-view', 'navigate-wallet-after-normal-configuration-activation',
  'wait-normal-wallet-replacement-after-view', 'wait-wallet-onboarding-after-configuration-activation',
  'restart-browser-context-before-wallet-creation', 'relaunch-browser-context-with-same-profile',
  'open-wallet-after-normal-browser-restart', 'wait-onboarding-after-normal-browser-restart',
  'arm-fundless-wallet-prover-observer', 'open-fundless-prover-diagnostic',
  'connect-fundless-prover-diagnostic', 'run-fundless-lace-proof',
  'verify-fundless-wallet-prover-observation', 'fundless-proof-completed',
  'create-fundless-diagnostic-page', 'wait-fundless-fixture-ready', 'wait-fundless-wallet-injection',
  'wait-fundless-wallet-permission', 'approve-fundless-wallet-origin',
  'wait-fundless-wallet-connected', 'read-fundless-wallet-public-metadata',
  'enable-midnight-onboarding-account', 'disable-cardano-onboarding-account',
  'finish-fresh-midnight-wallet', 'open-wallet-settings', 'open-wallet-network-settings',
  'select-wallet-testnet', 'select-wallet-midnight-preview', 'save-wallet-preview-network',
  'wait-wallet-network-sheet-close', 'open-wallet-proving-settings',
  'select-wallet-on-device-wasm', 'save-wallet-on-device-wasm',
  'save-wallet-on-device-wasm-keyboard', 'wait-keyboard-wallet-proving-settings-close',
  'wait-wallet-proving-settings-close', 'wait-wallet-proving-save-controls-usable',
  'close-saved-wallet-proving-settings', 'reopen-wallet-proving-settings',
  'verify-persisted-wallet-on-device-selection', 'close-reviewed-wallet-proving-settings',
  'wait-reviewed-wallet-proving-settings-close', 'return-wallet-portfolio',
  'connect-genuine-application', 'check-wallet-indexer-before-funding',
  'waiting-for-authorized-test-funding', 'generate-test-dust-through-wallet-ui',
  'waiting-for-usable-wallet-dust', 'wait-for-real-opening', 'wait-for-real-closing',
  'operation-deploy', 'operation-configure', 'operation-enroll', 'operation-open',
  'operation-cast', 'operation-close', 'operation-submit-share', 'operation-finalize',
]);
const PHASES = new Set(['preparation-started', 'preparation-completed', 'wallet-approval-requested',
  'wallet-signed', 'submission-returned', 'contract-proof-completed', 'no-contract-proof-required',
  'public-assets-loading', 'contract-constraints-checking', 'contract-proving']);
const OPERATIONS = Object.freeze(['Deployment', 'Key configuration', 'Enrollment', 'Voting opened',
  'Ballot', 'Voting closed', 'Trustee contribution', 'Trustee contribution', 'Tally finalized']);
const OP_STATUSES = new Set(['requested', 'indexer-accepted', 'uncertain']);
const DUST_STATUSES = new Set(['preparing', 'approval-requested', 'awaiting-wallet-sync',
  'positive-dust-observed', 'uncertain']);
const MAX_BYTES = 512 * 1024;
const UNAVAILABLE = JSON.stringify({ scope: 'lace-preview-progress', status: 'unavailable' });
function requireValue(ok) { if (!ok) throw new Error('Public progress validation failed'); }
function own(value, key) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const field = Object.getOwnPropertyDescriptor(value, key);
  requireValue(field && Object.hasOwn(field, 'value'));
  return field.value;
}

export function projectLaceProgress(value, expected) {
  requireValue(/^[1-9][0-9]{0,24}$/.test(expected?.runId ?? '') && /^[0-9a-f]{40}$/.test(expected?.headSha ?? ''));
  requireValue(own(value, 'schema') === 'midnight-ballot-lab/ci-lace-preview-browser/v1'
    && own(value, 'networkId') === 'preview' && own(value, 'runId') === expected.runId
    && own(value, 'headSha') === expected.headSha);
  const status = own(value, 'status'), stage = own(value, 'currentStage'), operations = own(value, 'operations');
  requireValue(['preparing', 'passed', 'failed'].includes(status) && LACE_PROGRESS_STAGES.includes(stage));
  requireValue(Array.isArray(operations) && operations.length <= 9);
  const output = operations.map((operation, index) => {
    const ordinal = own(operation, 'ordinal'), operationStatus = own(operation, 'status');
    requireValue(ordinal === index + 1 && own(operation, 'operation') === OPERATIONS[index] && OP_STATUSES.has(operationStatus));
    if (index === 6 || index === 7) requireValue(own(operation, 'trusteeIndex') === (index === 6 ? 1 : 3));
    const phases = own(operation, 'phases');
    requireValue(Array.isArray(phases) && phases.length <= PHASES.size && new Set(phases).size === phases.length
      && phases.every(phase => PHASES.has(phase)));
    return Object.freeze({ ordinal, status: operationStatus, phase: phases.at(-1) ?? null });
  });
  let dust = null;
  if (Object.hasOwn(value, 'dustRegistration')) {
    dust = own(own(value, 'dustRegistration'), 'status');
    requireValue(DUST_STATUSES.has(dust));
  }
  return Object.freeze({ scope: 'lace-preview-progress', status, stage, dust, operations: Object.freeze(output) });
}

export function progressText(bytes, expected) {
  try {
    const value = parseStrictJson(decodeJsonUtf8(bytes, { maxBytes: MAX_BYTES }), { maxBytes: MAX_BYTES, maxDepth: 12 });
    return JSON.stringify(projectLaceProgress(value, expected));
  } catch {
    throw new Error('Public progress validation failed');
  }
}

export function changedProgress(current, previous) {
  return current === previous ? null : current;
}

async function emitChanged(task, text) {
  const state = join(task, 'public-progress-state.json');
  let previous;
  try { previous = await readFile(state, 'utf8'); } catch { /* first public update */ }
  if (changedProgress(text, previous) === null) return;
  await writeFile(state + '.pending', text, { mode: 0o600 });
  await rename(state + '.pending', state);
  console.log(text);
}

async function main() {
  requireValue(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux');
  const temp = await realpath(process.env.RUNNER_TEMP), task = await realpath(process.env.LACE_TASK_DIR);
  requireValue(task.startsWith(temp + sep + 'midnight-lace-ci.') && dirname(task) === temp);
  requireValue((await readFile(join(task, 'task-owned'), 'utf8')).trim() === 'midnight-ballot-lab/lace-preview-ci/v1');
  const publicDirectory = await realpath(join(task, 'public'));
  requireValue(publicDirectory === join(task, 'public'));
  let file;
  try {
    file = await open(join(publicDirectory, 'browser-report.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === 'ENOENT') return; // The runner has not written its first report yet.
    await emitChanged(task, UNAVAILABLE);
    return;
  }
  try {
    const info = await file.stat();
    requireValue(info.isFile() && info.size > 0 && info.size <= MAX_BYTES);
    const bytes = new Uint8Array(info.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    requireValue(bytesRead === info.size);
    await emitChanged(task, progressText(bytes.subarray(0, bytesRead), {
      runId: process.env.GITHUB_RUN_ID, headSha: process.env.GITHUB_SHA,
    }));
  } catch {
    await emitChanged(task, UNAVAILABLE);
  } finally {
    await file.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Telemetry failure must not interrupt an uncertain funded operation.
  // Terminal acceptance is still checked by ci-lace-preview-public-check.mjs.
  main().catch(() => console.log(UNAVAILABLE));
}
