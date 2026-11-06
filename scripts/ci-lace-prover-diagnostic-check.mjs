/** Validate only the public, fundless CI diagnostic report. Never prints its contents. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJsonUtf8, parseStrictJson } from '../src/json.mjs';

const FIELDS = new Set([
  'schema', 'status', 'startedAt', 'finishedAt', 'networkId', 'execution', 'runId', 'headSha',
  'fundingAttempted', 'walletDustProofsTested', 'networkSubmissionAttempted', 'independentProofVerification',
  'privateArtifactsExported', 'hostedOriginTested', 'walletModeApiAttestation', 'httpProofProviderConfigured',
  'laceVersion', 'apiVersion', 'extensionId', 'extensionArchiveSha256', 'runnerSha256',
  'networkBundleSha256', 'workerSha256', 'diagnosticBuildSha256', 'proverObserverSha256', 'playwright', 'chromium',
  'vendorServiceConfiguration', 'publicConfigurationPreflight', 'normalBrowserContextRestart',
  'midnightOnlyAccountSelectionVerified', 'freshWalletCreated', 'lastSettingsControl',
  'visibleWalletServicesBeforeSave', 'settingsModeObservations', 'walletSettingsSaveActivations',
  'walletSettingsClose', 'walletOnDeviceWasmSelectedThroughUi', 'walletConnected', 'walletServices',
  'walletPublicConfigurationReloaded', 'contractProof', 'walletProverObservation',
  'failureCategory', 'failedStage', 'settingsControls', 'currentStage', 'traffic',
  'fundlessFixtureState', 'fundlessWalletAvailability',
]);
const FALSE_FIELDS = ['fundingAttempted', 'walletDustProofsTested', 'networkSubmissionAttempted',
  'independentProofVerification', 'privateArtifactsExported', 'hostedOriginTested',
  'walletModeApiAttestation', 'httpProofProviderConfigured'];
const MAX_BYTES = 512 * 1024;
function requireValue(ok) { if (!ok) throw new Error('Public diagnostic evidence validation failed'); }
function own(value, key) {
  const property = Object.getOwnPropertyDescriptor(value, key);
  requireValue(property && Object.hasOwn(property, 'value'));
  return property.value;
}
function plain(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
}
function hash(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function boundedInteger(value, maximum) { return Number.isSafeInteger(value) && value >= 0 && value <= maximum; }
function publicTree(value, depth = 0) {
  requireValue(depth <= 12);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { requireValue(Number.isFinite(value)); return; }
  if (typeof value === 'string') { requireValue(value.length <= 4096); return; }
  if (Array.isArray(value)) {
    requireValue(value.length <= 256);
    for (const entry of value) publicTree(entry, depth + 1);
    return;
  }
  plain(value);
  requireValue(Object.keys(value).length <= 64);
  for (const key of Object.keys(value)) {
    requireValue(!/^(?:password|seed|mnemonic|secret|secretShare|privateKey|witness|preimage|binding|rawTransaction|token|unshieldedAddress|dustAddress)$/i.test(key));
    publicTree(own(value, key), depth + 1);
  }
}
function observation(value) {
  plain(value);
  const required = ['observed', 'status', 'failureCategory', 'targetCounts', 'requestPayloadsInspected',
    'unrelatedEventsRetained', 'completeNetworkCoverage', 'runtimeEvaluationUsed', 'executionPaused', 'discovery'];
  const resource = ['path', 'bytes', 'sha256', 'targetKind', 'evidence'];
  const fields = value.observed === true ? [...required, ...resource] : required;
  requireValue(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))
    && typeof value.observed === 'boolean' && ['armed', 'closed', 'observed', 'failed'].includes(value.status)
    && (value.failureCategory === null || typeof value.failureCategory === 'string'
      && /^[a-z][a-z0-9-]{0,99}$/.test(value.failureCategory))
    && required.slice(4, 9).every(key => value[key] === false));
  plain(value.targetCounts);
  requireValue(Object.keys(value.targetCounts).length === 2
    && ['offscreen', 'worker'].every(key => boundedInteger(value.targetCounts[key], 8)));
  plain(value.discovery);
  requireValue(Object.keys(value.discovery).length === 3
    && boundedInteger(value.discovery.snapshots, 3600) && value.discovery.refreshLimit === 3600);
  const classifications = ['offscreenExact', 'offscreenOtherType', 'workerExact', 'workerOtherType',
    'workerUrlEmpty', 'extensionBlobWorker', 'extensionOther', 'other'];
  plain(value.discovery.classifiedTargets);
  requireValue(Object.keys(value.discovery.classifiedTargets).length === classifications.length
    && classifications.every(key => Object.hasOwn(value.discovery.classifiedTargets, key)
      && boundedInteger(value.discovery.classifiedTargets[key], 256)));
  if (value.observed) requireValue(value.path === 'js/bb7c1f073eb0bc071ea5.module.wasm'
    && value.bytes === 3_413_037
    && value.sha256 === 'f5326f9e869d7795edbe4a80ad1ed7f0e8636178f60c0268ecd4700787612cdb'
    && ['offscreen', 'worker'].includes(value.targetKind) && value.evidence === 'passive-cdp-resource-response');
  requireValue(value.status !== 'observed' || value.observed && value.failureCategory === null);
  requireValue(value.status !== 'failed' || value.failureCategory !== null);
}

export function validateDiagnosticReport(value, expected, completed = false) {
  plain(value);
  publicTree(value);
  requireValue(Object.keys(value).every(key => FIELDS.has(key))
    && /^[1-9][0-9]{0,24}$/.test(expected?.runId ?? '') && /^[0-9a-f]{40}$/.test(expected?.headSha ?? '')
    && own(value, 'schema') === 'midnight-ballot-lab/ci-lace-prover-diagnostic/v1'
    && own(value, 'execution') === 'genuine-disposable-Lace-fundless-contract-proof'
    && own(value, 'networkId') === 'preview' && own(value, 'runId') === expected.runId
    && own(value, 'headSha') === expected.headSha
    && ['preparing', 'passed', 'failed'].includes(own(value, 'status'))
    && FALSE_FIELDS.every(key => own(value, key) === false));
  for (const key of ['startedAt', 'finishedAt']) {
    if (Object.hasOwn(value, key)) requireValue(typeof own(value, key) === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value[key]));
  }
  for (const key of ['currentStage', 'failedStage', 'failureCategory']) {
    if (Object.hasOwn(value, key)) requireValue(value[key] === null
      || typeof value[key] === 'string' && /^[a-z][a-zA-Z0-9-]{0,99}$/.test(value[key]));
  }
  for (const key of ['extensionArchiveSha256', 'runnerSha256', 'networkBundleSha256',
    'workerSha256', 'diagnosticBuildSha256', 'proverObserverSha256']) {
    if (Object.hasOwn(value, key)) requireValue(hash(value[key]));
  }
  if (Object.hasOwn(value, 'contractProof')) {
    const proof = value.contractProof;
    plain(proof);
    const keys = ['circuit', 'constraintCheck', 'bytes', 'sha256', 'elapsedMs'];
    requireValue(Object.keys(proof).length === keys.length && keys.every(key => Object.hasOwn(proof, key))
      && proof.circuit === 'openVoting' && proof.constraintCheck === 'passed'
      && boundedInteger(proof.bytes, 16 * 1024 * 1024) && proof.bytes > 0
      && hash(proof.sha256) && boundedInteger(proof.elapsedMs, 20 * 60_000));
  }
  if (Object.hasOwn(value, 'walletProverObservation')) observation(value.walletProverObservation);
  if (Object.hasOwn(value, 'fundlessFixtureState')) {
    const fixture = value.fundlessFixtureState;
    plain(fixture);
    requireValue(Object.keys(fixture).length === (Object.hasOwn(fixture, 'failureCategory') ? 3 : 2)
      && ['ready', 'connected', 'running', 'passed', 'failed'].includes(fixture.status)
      && ['ready', 'connecting', 'connected', 'validate-connection', 'load-public-material',
        'prepare-real-circuit', 'check-openVoting', 'prove-openVoting', 'complete'].includes(fixture.stage)
      && (!Object.hasOwn(fixture, 'failureCategory') || ['wallet-connection-failed',
        'contract-proof-diagnostic-failed'].includes(fixture.failureCategory)));
  }
  if (Object.hasOwn(value, 'fundlessWalletAvailability')) {
    const availability = value.fundlessWalletAvailability;
    plain(availability);
    requireValue(Object.keys(availability).length === 2
      && boundedInteger(availability.matchingWalletCount, 99) && typeof availability.expectedApi === 'boolean');
  }
  if (completed) {
    requireValue(value.status === 'passed' && value.finishedAt && value.contractProof
      && value.laceVersion === '2.5.1' && value.extensionId === 'gafhhkghbfjjkeiendhlofajokpaflmk'
      && value.apiVersion === '4.1.0-canary.20260819082604-3b622cb'
      && value.extensionArchiveSha256 === 'aa6d59550362a3bbcbef343dffd783621150a7971307116bb11fe0d94b754708'
      && ['runnerSha256', 'networkBundleSha256', 'workerSha256', 'diagnosticBuildSha256',
        'proverObserverSha256'].every(key => hash(value[key]))
      && value.walletConnected === true && value.walletOnDeviceWasmSelectedThroughUi === true
      && value.fundlessWalletAvailability?.matchingWalletCount === 1 && value.fundlessWalletAvailability.expectedApi === true
      && value.fundlessFixtureState?.status === 'passed' && value.fundlessFixtureState.stage === 'complete'
      && !Object.hasOwn(value.fundlessFixtureState, 'failureCategory')
      && value.walletProverObservation?.observed === true
      && value.walletProverObservation.status === 'observed' && value.walletProverObservation.failureCategory === null
      && value.failureCategory == null && value.failedStage == null);
  }
}

export function decodeDiagnosticReport(bytes, expected, completed = false) {
  const value = parseStrictJson(decodeJsonUtf8(bytes, { maxBytes: MAX_BYTES }), { maxBytes: MAX_BYTES, maxDepth: 12 });
  validateDiagnosticReport(value, expected, completed);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux');
    const mode = process.argv[2];
    requireValue(['publication', 'completed'].includes(mode));
    const temp = await realpath(process.env.RUNNER_TEMP);
    const task = await realpath(process.env.LACE_DIAGNOSTIC_TASK_DIR);
    const publicDirectory = await realpath(join(task, 'public'));
    const file = await realpath(process.argv[3]);
    requireValue(dirname(task) === temp && basename(task).startsWith('midnight-lace-diagnostic.')
      && publicDirectory === join(task, 'public') && dirname(file) === publicDirectory
      && basename(file) === 'prover-diagnostic-report.json' && file.startsWith(temp + sep));
    const info = await stat(file);
    requireValue(info.isFile() && info.size > 0 && info.size <= MAX_BYTES);
    decodeDiagnosticReport(await readFile(file), {
      runId: process.env.GITHUB_RUN_ID, headSha: process.env.GITHUB_SHA,
    }, mode === 'completed');
    console.log(JSON.stringify({ status: 'passed', scope: 'fundless-public-report-validation', check: mode }));
  } catch {
    console.error('Public diagnostic evidence validation failed; no report contents were logged.');
    process.exitCode = 1;
  }
}
