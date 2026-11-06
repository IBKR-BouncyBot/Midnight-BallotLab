/** CI public-file boundary only. Never prints addresses or arbitrary report data. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStrictJson } from '../src/json.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionId = 'gafhhkghbfjjkeiendhlofajokpaflmk';
function requireValue(value) { if (!value) throw new Error('Public CI evidence validation failed'); }

export async function loadOfficialAddressCodec() {
  const folder = join(root, 'contracts/node_modules/@midnight-ntwrk/wallet-sdk-address-format');
  const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  requireValue(pkg.name === '@midnight-ntwrk/wallet-sdk-address-format'
    && pkg.version === '3.1.2' && pkg.exports?.['.']?.import === './dist/index.js');
  return import(pathToFileURL(join(folder, 'dist/index.js')).href);
}

export function validateFundingRequest(value, expected, codec) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  const fields = ['schema', 'networkId', 'runId', 'headSha', 'nonce', 'unshieldedAddress',
    'laceVersion', 'extensionId', 'maximumFundingAtomic'];
  requireValue(Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)));
  requireValue(value.schema === 'midnight-ballot-lab/lace-preview-funding-request/v1'
    && value.networkId === 'preview' && value.runId === expected.runId && value.headSha === expected.headSha
    && /^[1-9][0-9]{0,24}$/.test(value.runId) && /^[0-9a-f]{40}$/.test(value.headSha)
    && /^[0-9a-f]{64}$/.test(value.nonce) && value.laceVersion === '2.5.1'
    && value.extensionId === extensionId && value.maximumFundingAtomic === '5000000000');
  requireValue(typeof value.unshieldedAddress === 'string' && value.unshieldedAddress.length <= 512
    && value.unshieldedAddress.startsWith('mn_addr_preview1'));
  const parsed = codec.MidnightBech32m.parse(value.unshieldedAddress);
  parsed.decode(codec.UnshieldedAddress, 'preview');
  requireValue(parsed.asString() === value.unshieldedAddress);
}

export function validateCompletedReport(value, expected) {
  const operations = ['Deployment', 'Key configuration', 'Enrollment', 'Voting opened', 'Ballot',
    'Voting closed', 'Trustee contribution', 'Trustee contribution', 'Tally finalized'];
  requireValue(value?.schema === 'midnight-ballot-lab/ci-lace-preview-browser/v1'
    && value.status === 'passed' && value.networkId === 'preview'
    && value.runId === expected.runId && value.headSha === expected.headSha
    && value.laceVersion === '2.5.1' && value.extensionId === extensionId
    && value.transactionsRetried === 0 && value.privateArtifactsExported === false
    && value.httpProofProviderConfigured === false && value.hostedOriginTested === false
    && value.independentChainVerification === false && value.walletModeApiAttestation === false
    && value.walletConnected === true && value.positiveDustObserved === true
    && value.publicRecordConsistent === true && value.walletProverWasm?.observed === true
    && value.acceptedApplicationTransactions === 9 && value.observedContractProofCompletions === 8
    && Array.isArray(value.operations) && value.operations.length === 9
    && value.operations.every((operation, index) => operation.status === 'indexer-accepted'
      && operation.ordinal === index + 1 && operation.operation === operations[index]
      && typeof operation.txId === 'string' && /^[0-9a-f]{64,128}$/.test(operation.txId))
    && new Set(value.operations.map(operation => operation.txId)).size === 9
    && value.operations[6].trusteeIndex === 1 && value.operations[7].trusteeIndex === 3);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.env.GITHUB_ACTIONS === 'true' && process.platform === 'linux');
    const temp = await realpath(process.env.RUNNER_TEMP);
    const task = await realpath(process.env.LACE_TASK_DIR);
    const file = await realpath(process.argv[3]);
    requireValue(task.startsWith(temp + sep) && file.startsWith(join(task, 'public') + sep));
    const info = await stat(file);
    requireValue(info.isFile() && info.size > 0 && info.size <= 512 * 1024);
    const bytes = await readFile(file);
    const value = parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maxBytes: 512 * 1024, maxDepth: 12 });
    const expected = { runId: process.env.GITHUB_RUN_ID, headSha: process.env.GITHUB_SHA };
    if (process.argv[2] === 'funding') validateFundingRequest(value, expected, await loadOfficialAddressCodec());
    else if (process.argv[2] === 'completed') validateCompletedReport(value, expected);
    else requireValue(false);
    console.log(JSON.stringify({ status: 'passed', scope: 'public-ci-report-validation', check: process.argv[2] }));
  } catch {
    console.error('Public CI evidence validation failed; no report contents were logged.');
    process.exitCode = 1;
  }
}
