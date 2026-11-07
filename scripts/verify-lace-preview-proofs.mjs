/** Read-only public ledger-9 transaction inspection. No wallet, signing,
 * proving, funding, submission, private state, or raw transaction export.
 *
 * Usage: node scripts/verify-lace-preview-proofs.mjs --report FILE
 *   --run-id ID --head-sha SHA --output NEW_FILE
 * Requires a completed current-chain report; this is never a transaction retry.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStrictJson } from '../src/json.mjs';
import { PREVIEW_PUBLIC_SERVICES, requirePreviewChainIdentity, validatePreviewChainIdentity } from '../contracts/native/public-testnet.mjs';
import { validateCompletedReport } from './ci-lace-preview-public-check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireContracts = createRequire(join(root, 'contracts/package.json'));
const ledger = await import(pathToFileURL(requireContracts.resolve('@midnightntwrk/ledger-v9')).href);
const HASH = /^[0-9a-f]{64}$/;
// Confirmed from actual installed ledger-v9 1.0.0 Transaction.identifiers().
const IDENTIFIER = /^00[0-9a-f]{64}$/;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_PROOF_BYTES = 16 * 1024 * 1024;
const CIRCUITS = Object.freeze([null, 'configureKeys', 'enroll', 'openVoting', 'castBallot',
  'closeVoting', 'submitDecryption', 'submitDecryption', 'finalize']);
const QUERY = `query BallotPublicProofPresence($offset: TransactionOffset!) {
  transactions(offset: $offset) {
    __typename raw hash protocolVersion block { height hash timestamp }
    ... on RegularTransaction { identifiers transactionResult { status } }
  }
}`;
const failureCodes = new WeakMap();
function fail(code) { const error = new Error('Public transaction inspection failed'); failureCodes.set(error, code); throw error; }
function requireValue(value, code = 'invalid-public-record') { if (!value) fail(code); }
export function publicInspectionFailureCode(error) { return failureCodes.get(error) ?? 'public-inspection-failed'; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max); return value;
}
function exact(value, fields) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === fields.length
    && fields.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value')));
}
function parse(bytes, maxBytes) {
  try { return parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), { maxBytes, maxDepth: 16 }); }
  catch { fail('invalid-public-json'); }
}

/** Validate and project public identifiers only. No report text is re-exported. */
export function inspectionPlan(report, expected) {
  try { validateCompletedReport(report, expected); } catch { fail('incomplete-or-wrong-chain-report'); }
  requireValue(typeof expected.runId === 'string' && /^[1-9][0-9]{0,24}$/.test(expected.runId)
    && typeof expected.headSha === 'string' && /^[0-9a-f]{40}$/.test(expected.headSha));
  requireValue(HASH.test(report.contractAddress) && !/^0+$/.test(report.contractAddress));
  const chainIdentity = validatePreviewChainIdentity(report.chainIdentity);
  return Object.freeze({ runId: expected.runId, headSha: expected.headSha,
    contractAddress: report.contractAddress, chainIdentity,
    operations: Object.freeze(report.operations.map((op, index) => {
      requireValue(IDENTIFIER.test(op.txId), 'invalid-transaction-identifier');
      return Object.freeze({ ordinal: index + 1, txId: op.txId,
        blockHeight: integer(op.blockHeight, 1), circuit: CIRCUITS[index] });
    })) });
}

/** Independently verify only unshielded-input signatures, with the actual
 * installed Ledger signature algorithm and its own intent signing payload.
 * This does not verify DUST registration, binding, or contract signatures.
 */
export function verifyPublicUnshieldedSignatures(intent, segment) {
  try {
    requireValue(intent instanceof ledger.Intent, 'invalid-ledger-intent');
    integer(segment, 0, 65535);
    const payload = intent.signatureData(segment);
    let count = 0;
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]) {
      if (!offer) continue;
      const inputs = offer.inputs, signatures = offer.signatures;
      requireValue(inputs.length <= 4096 && inputs.length === signatures.length, 'unshielded-signature-mismatch');
      for (let index = 0; index < inputs.length; index++) {
        requireValue(signatures[index]?.instance === 'signature'
          && ledger.verifySignature(inputs[index].owner, payload, signatures[index].value), 'unshielded-signature-mismatch');
        count++;
      }
    }
    return count;
  } catch (error) { if (failureCodes.has(error)) throw error; fail('unshielded-signature-mismatch'); }
}

function proofMetadata(proof, code) {
  requireValue(proof instanceof ledger.Proof && proof.instance === 'proof', code);
  const bytes = proof.serialize();
  requireValue(bytes.length > 0 && bytes.length <= MAX_PROOF_BYTES, code);
  return Object.freeze({ serializedBytes: bytes.length, serializedSha256: sha256(bytes) });
}

export function inspectFinalizedPublicTransaction(indexed, operation, contractAddress, identity) {
  try {
    validatePreviewChainIdentity(identity);
    exact(indexed, ['__typename', 'raw', 'hash', 'protocolVersion', 'block', 'identifiers', 'transactionResult']);
    exact(indexed.block, ['height', 'hash', 'timestamp']);
    exact(indexed.transactionResult, ['status']);
    requireValue(indexed.__typename === 'RegularTransaction' && indexed.transactionResult.status === 'SUCCESS',
      'transaction-not-fully-successful');
    requireValue(indexed.protocolVersion === identity.protocolVersion, 'transaction-era-mismatch');
    requireValue(HASH.test(contractAddress) && HASH.test(indexed.hash) && HASH.test(indexed.block.hash));
    requireValue(integer(indexed.block.height, 1) === operation.blockHeight, 'transaction-block-mismatch');
    integer(indexed.block.timestamp, 1, 8_640_000_000_000_000);
    requireValue(IDENTIFIER.test(operation.txId) && Array.isArray(indexed.identifiers)
      && indexed.identifiers.length > 0 && indexed.identifiers.length <= 128
      && indexed.identifiers.every(id => typeof id === 'string' && IDENTIFIER.test(id))
      && new Set(indexed.identifiers).size === indexed.identifiers.length
      && indexed.identifiers.includes(operation.txId), 'transaction-identity-mismatch');
    requireValue(typeof indexed.raw === 'string' && indexed.raw.length > 0
      && indexed.raw.length <= MAX_RESPONSE_BYTES && /^(?:[0-9a-f]{2})+$/.test(indexed.raw), 'invalid-transaction-bytes');
    const bytes = Buffer.from(indexed.raw, 'hex');
    let tx;
    try { tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes); }
    catch { fail('transaction-deserialization-failed'); }
    requireValue(tx.transactionHash() === indexed.hash && Buffer.from(tx.serialize()).equals(bytes), 'transaction-identity-mismatch');
    const identifiers = tx.identifiers();
    requireValue(identifiers.length === indexed.identifiers.length
      && identifiers.every(id => indexed.identifiers.includes(id)), 'transaction-identity-mismatch');
    requireValue(tx.intents instanceof Map && tx.intents.size > 0 && tx.intents.size <= 128 && !tx.rewards,
      'unexpected-transaction-shape');
    let deployments = 0, unshieldedSignaturesVerified = 0, dustRegistrationCount = 0;
    const contractProofs = [], dustSpendProofs = [];
    for (const [segment, intent] of tx.intents) {
      unshieldedSignaturesVerified += verifyPublicUnshieldedSignatures(intent, segment);
      requireValue(intent.actions.length <= 128, 'unexpected-transaction-shape');
      for (const action of intent.actions) {
        requireValue(action.address === contractAddress, 'wrong-contract-action');
        if (action instanceof ledger.ContractDeploy) {
          requireValue(operation.circuit === null, 'wrong-contract-action'); deployments++;
        } else {
          requireValue(action instanceof ledger.ContractCall && operation.circuit !== null, 'wrong-contract-action');
          const entryPoint = typeof action.entryPoint === 'string' ? action.entryPoint
            : new TextDecoder('utf-8', { fatal: true }).decode(action.entryPoint);
          requireValue(entryPoint === operation.circuit, 'wrong-contract-action');
          contractProofs.push(proofMetadata(action.proof, 'missing-contract-proof'));
        }
      }
      if (intent.dustActions) {
        requireValue(intent.dustActions.spends.length <= 4096 && intent.dustActions.registrations.length <= 4096,
          'unexpected-transaction-shape');
        dustRegistrationCount += intent.dustActions.registrations.length;
        for (const spend of intent.dustActions.spends) dustSpendProofs.push(proofMetadata(spend.proof, 'missing-dust-proof'));
      }
    }
    requireValue(operation.circuit === null ? deployments === 1 && contractProofs.length === 0
      : deployments === 0 && contractProofs.length === 1, 'wrong-contract-action');
    requireValue(dustSpendProofs.length >= 1, 'missing-dust-proof');
    return Object.freeze({ ordinal: operation.ordinal, txId: operation.txId, circuit: operation.circuit,
      transactionHash: indexed.hash, serializedTransactionBytes: bytes.length, serializedTransactionSha256: sha256(bytes),
      blockHeight: indexed.block.height, blockHash: indexed.block.hash, blockTimestampMilliseconds: indexed.block.timestamp,
      protocolVersion: indexed.protocolVersion, indexerStatus: 'SUCCESS',
      contractProofCount: contractProofs.length, contractProofs, dustSpendProofCount: dustSpendProofs.length, dustSpendProofs,
      dustRegistrationCount, unshieldedSignaturesVerified });
  } catch (error) { if (failureCodes.has(error)) throw error; fail('invalid-public-transaction'); }
}

async function publicJson(url, body, maxBytes) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal });
    requireValue(response.ok && !response.redirected && response.url === url && response.body, 'public-service-unavailable');
    const length = response.headers.get('content-length');
    requireValue(length === null || (/^[0-9]+$/.test(length) && Number(length) <= maxBytes), 'public-response-too-large');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > maxBytes) { await reader.cancel(); fail('public-response-too-large'); }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    return parse(Buffer.concat(chunks, size), maxBytes);
  } catch (error) { if (failureCodes.has(error)) throw error; fail('public-service-unavailable'); }
  finally { clearTimeout(timer); controller.abort(); }
}

export async function inspectAcceptedReport(reportBytes, expected) {
  const plan = inspectionPlan(parse(reportBytes, MAX_REPORT_BYTES), expected);
  // Fresh pinned genesis/protocol/indexer-to-RPC block checks before any tx query.
  const identity = await requirePreviewChainIdentity({}, plan.chainIdentity);
  const observations = [];
  for (const operation of plan.operations) {
    const value = await publicJson(PREVIEW_PUBLIC_SERVICES.indexerUri,
      { query: QUERY, variables: { offset: { identifier: operation.txId } } }, MAX_RESPONSE_BYTES);
    requireValue(!value.errors && Array.isArray(value.data?.transactions) && value.data.transactions.length === 1,
      'transaction-not-uniquely-indexed');
    const observed = inspectFinalizedPublicTransaction(value.data.transactions[0], operation, plan.contractAddress, identity);
    const block = await publicJson(PREVIEW_PUBLIC_SERVICES.nodeRpc,
      { jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [observed.blockHeight] }, 16_384);
    requireValue(block.jsonrpc === '2.0' && block.id === 1 && !block.error
      && block.result === `0x${observed.blockHash}`, 'indexer-rpc-block-mismatch');
    observations.push(observed);
  }
  await requirePreviewChainIdentity({}, identity);
  requireValue(observations.reduce((n, tx) => n + tx.contractProofCount, 0) === 8, 'contract-proof-count-mismatch');
  return { schema: 'midnight-ballot-lab/public-ledger9-proof-presence/v1', status: 'passed', checkedAt: new Date().toISOString(),
    runId: plan.runId, headSha: plan.headSha, sourceReportSha256: sha256(reportBytes), chainIdentity: identity,
    contractAddress: plan.contractAddress, ledgerPackage: '@midnightntwrk/ledger-v9', ledgerVersion: '1.0.0',
    source: { indexer: PREVIEW_PUBLIC_SERVICES.indexerUri, rpc: PREVIEW_PUBLIC_SERVICES.nodeRpc },
    transactions: observations, acceptedTransactionCount: observations.length, contractProofCount: 8,
    dustSpendProofCount: observations.reduce((n, tx) => n + tx.dustSpendProofCount, 0),
    unshieldedSignaturesVerified: observations.reduce((n, tx) => n + tx.unshieldedSignaturesVerified, 0),
    publicTransactionHashesRecomputed: true, indexerRpcBlockHashesAgree: true,
    independentCryptographicProofVerification: false, fullTransactionWellFormednessVerified: false,
    independentConsensusVerification: false, proofGenerationBackendAttested: false, walletDustBackendAttested: false,
    historicalLedgerStateAvailable: false,
    proofVerificationUnavailableReason: 'historical-ledger-state-with-dust-roots-and-contract-verifier-keys-not-supplied',
    signatureVerificationScope: 'unshielded-input-signatures-only', networkSubmission: false, walletAccess: false,
    rawTransactionsExported: false, privateDataExported: false };
}

async function main(args) {
  try {
    requireValue(args.length === 8 && args[0] === '--report' && args[2] === '--run-id'
      && args[4] === '--head-sha' && args[6] === '--output', 'invalid-arguments');
    const input = resolve(args[1]), output = resolve(args[7]);
    requireValue(input !== output, 'invalid-output');
    const info = await stat(input); requireValue(info.isFile() && info.size > 0 && info.size <= MAX_REPORT_BYTES);
    const pkg = JSON.parse(await readFile(join(root, 'contracts/node_modules/@midnightntwrk/ledger-v9/package.json'), 'utf8'));
    requireValue(pkg.name === '@midnightntwrk/ledger-v9' && pkg.version === '1.0.0', 'unsupported-ledger-package');
    const result = await inspectAcceptedReport(await readFile(input), { runId: args[3], headSha: args[5] });
    result.inspectorSha256 = sha256(await readFile(fileURLToPath(import.meta.url)));
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: 'passed', scope: 'public-ledger9-proof-presence', transactions: 9,
      contractProofs: 8, dustSpendProofs: result.dustSpendProofCount, independentCryptographicProofVerification: false }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', failureCategory: publicInspectionFailureCode(error),
      networkSubmission: false, privateDiagnosticsWithheld: true })); process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
