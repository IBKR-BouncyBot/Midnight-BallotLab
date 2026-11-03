/** Real transactions on the explicitly selected, isolated local devnet only.
 * No wallet secret, witness, private context, raw exception or transaction body
 * is logged. The installed official genesis fixture is read in memory only.
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageRuntime } from './stage-runtime.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const contracts = resolve(directory, '..');
const root = resolve(contracts, '..');
const evidenceDirectory = join(root, 'artifacts/local-devnet');
const evidencePath = join(evidenceDirectory, 'network-evidence.json');
const env = Object.freeze({ networkId: 'undeployed', walletNetworkId: 'undeployed',
  node: 'http://127.0.0.1:9944', nodeWS: 'ws://127.0.0.1:9944',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql', indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  proofServer: 'http://127.0.0.1:6300', faucet: undefined });
const hex = bytes => Buffer.from(bytes).toString('hex');
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const output = value => process.stdout.write(JSON.stringify(value) + '\n');
let stage = 'prerequisites', walletProvider, db, privateDirectory, lastSubmittedTransaction;
let proofCompletions = 0, submissionAttempts = 0;
const evidence = { executedAt: new Date().toISOString(), networkId: 'undeployed',
  environment: 'fresh-isolated-local-development-chain', confirmationSource: 'configured-local-indexer',
  independentlyVerifiedChainInclusion: false, browserWalletTested: false,
  acceptedTransactions: [], rejectedBeforeSubmission: [], proofTransactionsCompleted: 0,
  networkSubmission: false, status: 'running' };

function failureCategory(error) {
  // Inspect messages only to choose a fixed category. Never retain raw text.
  const seen = new Set(); let cursor = error; const messages = [];
  for (let count = 0; cursor && count < 8 && !seen.has(cursor); count++) {
    seen.add(cursor); if (typeof cursor.message === 'string') messages.push(cursor.message); cursor = cursor.cause;
  }
  const text = messages.join(' ');
  if (/already imported|already in the pool|already known|duplicate transaction/i.test(text)) return 'duplicate-submission';
  if (/timed? ?out|timeout/i.test(text)) return 'timeout-uncertain-outcome';
  if (/insufficient|dust|balance|fund/i.test(text)) return 'wallet-funding-or-balancing';
  if (/connection|ECONN|fetch|socket|network/i.test(text)) return 'service-connection';
  if (/proof|prover|verification/i.test(text)) return 'proof-or-verification';
  if (/assert|constraint|already voted|wrong trustee|incorrect tally|deadline|started/i.test(text)) return 'contract-constraint';
  return 'operation-failed-details-withheld';
}
async function save() {
  evidence.proofTransactionsCompleted = proofCompletions;
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
}
async function bounded(promise, timeoutMs = 360_000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Operation timeout; outcome may be uncertain')), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
async function operation(name, callback) {
  stage = name; evidence.currentStage = name;
  output({ stage: name, status: 'started' }); await save();
  return bounded(callback());
}
async function blockTime() {
  const response = await fetch(env.indexer, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ block { height timestamp } }' }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error('Local indexer unavailable');
  const body = await response.json();
  const timestamp = body.data?.block?.timestamp;
  if (body.errors || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new Error('Local indexer block timestamp unavailable');
  return { seconds: Math.floor(timestamp / 1000), height: String(body.data.block.height) };
}
async function waitUntilChainTime(target, label) {
  stage = label; const deadline = Date.now() + 900_000; let lastNotice = 0;
  while ((await blockTime()).seconds < target || Math.floor(Date.now() / 1000) < target) {
    if (Date.now() > deadline) throw new Error('Network clock wait timed out');
    if (Date.now() - lastNotice > 30_000) { output({ stage: label, status: 'waiting-for-real-chain-time', target }); lastNotice = Date.now(); }
    await delay(3000);
  }
}

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--isolated-local-devnet') throw new Error('Explicit local development acceptance argument required');
  if (process.env.MN_TEST_WALLET_SEED || process.env.TEST_WALLET_SEED) throw new Error('External wallet credentials are not accepted by this isolated run');
  const staged = await stageRuntime(); evidence.sourceHashes = staged.hashes;
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  evidence.lockfileSha256 = createHash('sha256').update(await readFile(join(directory, 'package-lock.json'))).digest('hex');
  evidence.versions = Object.fromEntries(['compact-runtime', 'midnight-js-contracts', 'testkit-js', 'wallet-sdk', 'ledger-v8', 'onchain-runtime-v3', 'zkir-v2']
    .map(name => [name, lock.packages[`node_modules/@midnight-ntwrk/${name}`]?.version]));
  evidence.node = process.version;
  const [testkit, { default: pino }, ledger, network, { NodeZkConfigProvider }, { httpClientProofProvider },
    { indexerPublicDataProvider }, { levelPrivateStateProvider }, { Level }, Rx, { default: WebSocket }, { validatePassword }, native, adapter, { createNativeSdkClient }] = await Promise.all([
    import('@midnight-ntwrk/testkit-js'), import('pino'), import('@midnight-ntwrk/midnight-js-protocol/ledger'),
    import('@midnight-ntwrk/midnight-js-network-id'), import('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    import('@midnight-ntwrk/midnight-js-http-client-proof-provider'), import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    import('@midnight-ntwrk/midnight-js-level-private-state-provider'), import('level'), import('rxjs'), import('ws'), import('@midnight-ntwrk/midnight-js-utils'),
    import(pathToFileURL(join(staged.runtime, 'managed/native-election/contract/index.js')).href),
    import(pathToFileURL(join(staged.runtime, 'native/adapter.mjs')).href),
    import(pathToFileURL(join(staged.runtime, 'native/sdk-client.mjs')).href),
  ]);
  // Both loggers are silenced BEFORE constructing any wallet or reading fixture credentials.
  testkit.logger.level = 'silent'; const silent = pino({ level: 'silent' });
  // Library diagnostics may format secret-bearing objects. The runner writes
  // only its allowlisted public records directly to stdout.
  evidence.suppressedLibraryConsoleCalls = 0;
  for (const method of ['log', 'debug', 'info', 'warn', 'error', 'trace', 'dir']) {
    console[method] = () => { evidence.suppressedLibraryConsoleCalls++; };
  }
  globalThis.WebSocket = WebSocket; network.setNetworkId('undeployed');
  const fixture = new testkit.LocalTestEnvironment(silent);
  const built = await operation('build-synthetic-local-wallet', () => testkit.FluentWalletBuilder.forEnvironment(env)
    .withSeed(fixture.genesisMintWalletSeed[0]).buildWithoutStarting());
  walletProvider = await testkit.MidnightWalletProvider.withWallet(silent, env, built.wallet,
    ledger.ZswapSecretKeys.fromSeed(built.seeds.shielded), ledger.DustSecretKey.fromSeed(built.seeds.dust), built.keystore);
  await operation('start-local-wallet', () => walletProvider.start(false));
  // Observe the real wallet states directly. The testkit helper interpolates
  // balances into log arguments even with its logger disabled.
  await operation('synchronize-local-wallet', () => Rx.firstValueFrom(built.wallet.state().pipe(
    Rx.filter(value => value.shielded.state.progress.isStrictlyComplete()
      && value.dust.state.progress.isStrictlyComplete() && value.unshielded.progress.isStrictlyComplete()),
    Rx.take(1), Rx.timeout(300_000))));
  await operation('wait-for-spendable-local-dust', async () => {
    const walletState = await Rx.firstValueFrom(built.wallet.state().pipe(Rx.filter(value => value.dust.availableCoins.length > 0), Rx.take(1), Rx.timeout(300_000)));
    const deadline = Date.now() + 180_000;
    while (walletState.dust.balance(new Date((await blockTime()).seconds * 1000)) <= 0n) {
      if (Date.now() > deadline) throw new Error('Local genesis DUST is not yet spendable');
      await delay(2000);
    }
  });
  privateDirectory = await mkdtemp(join(tmpdir(), 'midnight-ballot-devnet-'));
  let password;
  for (;;) {
    password = `Local-${randomBytes(32).toString('base64url')}-Q7!`;
    try { validatePassword(password); break; } catch { /* Retry random pattern collisions. */ }
  }
  const privateStateProvider = levelPrivateStateProvider({ midnightDbName: join(privateDirectory, 'private-state'),
    accountId: walletProvider.getCoinPublicKey(), privateStoragePasswordProvider: () => password,
    levelFactory: name => { db = new Level(name, { valueEncoding: 'utf8' }); return db; } });
  const zkConfigProvider = new NodeZkConfigProvider(join(contracts, 'managed/native-election'));
  const proofProvider = httpClientProofProvider(env.proofServer, zkConfigProvider, { timeout: 300_000 });
  const publicDataProvider = indexerPublicDataProvider(env.indexer, env.indexerWS, WebSocket);
  const providers = { privateStateProvider, publicDataProvider, zkConfigProvider, walletProvider,
    proofProvider: { async proveTx(transaction, options) {
      const proven = await proofProvider.proveTx(transaction, options);
      if (stage !== 'deploy') proofCompletions++;
      return proven;
    } }, midnightProvider: { async submitTx(transaction) {
      submissionAttempts++; lastSubmittedTransaction = transaction;
      const txId = await walletProvider.submitTx(transaction);
      evidence.networkSubmission = true; evidence.pendingSubmission = { operation: stage, txId }; await save();
      return txId;
    } } };
  const client = createNativeSdkClient(providers, { compiledAssetsPath: join(contracts, 'managed/native-election'), networkId: 'undeployed' });
  const administratorSecret = adapter.randomSecret32(), dealer = adapter.createDemoDealer();
  const voterSecrets = Array.from({ length: 5 }, adapter.randomSecret32);
  const selections = [0n, 1n, 2n, 0n, 2n]; // Never projected to logs or evidence.
  const now = Math.max((await blockTime()).seconds, Math.floor(Date.now() / 1000));
  const opensAt = now + 240, closesAt = opensAt + 240;
  evidence.schedule = { opensAt, closesAt }; evidence.expectedTotals = [2, 1, 2];
  async function accepted(name, callback) {
    const result = await operation(name, callback);
    assert.match(result.txId, /^[0-9a-f]+$/i);
    const confirmation = await bounded(publicDataProvider.watchForTxData(result.txId), 60_000);
    assert.equal(confirmation.status, 'SucceedEntirely');
    evidence.acceptedTransactions.push({ operation: name, txId: result.txId, blockHeight: String(confirmation.blockHeight), status: confirmation.status });
    delete evidence.pendingSubmission; await save(); output({ stage: name, status: 'accepted-by-local-chain', txId: result.txId, blockHeight: String(confirmation.blockHeight) });
    return result;
  }
  async function rejectedBeforeSubmission(name, callback) {
    const before = { proofCompletions, submissionAttempts }; let rejected = false;
    try { await operation(name, callback); } catch { rejected = true; }
    assert.equal(rejected, true); assert.equal(proofCompletions, before.proofCompletions); assert.equal(submissionAttempts, before.submissionAttempts);
    evidence.rejectedBeforeSubmission.push({ operation: name, rejected: true, proofGenerated: false, submitted: false }); await save();
  }
  const deployment = await accepted('deploy', () => client.deploy({ electionId: adapter.randomSecret32(), manifestDigest: adapter.randomSecret32(),
    administratorIdentity: native.pureCircuits.administratorIdentity(administratorSecret), opensAt: BigInt(opensAt), closesAt: BigInt(closesAt) }));
  evidence.contractAddress = deployment.contractAddress;
  await accepted('configure-keys', () => client.configureKeys({ administratorSecret, setupSecret: dealer.setupSecret, setupSlope: dealer.setupSlope }));
  evidence.configurationDigest = hex(client.configurationDigest);
  for (let index = 0; index < voterSecrets.length; index++) {
    const state = await client.readPublicLedger();
    await accepted(`enroll-${index + 1}`, () => client.enroll(native.pureCircuits.memberIdentity(state.electionId, voterSecrets[index]), administratorSecret));
  }
  await waitUntilChainTime(opensAt + 2, 'wait-for-voting-open');
  await accepted('open-voting', () => client.openVoting());
  const receipts = [];
  for (let index = 0; index < voterSecrets.length; index++) receipts.push(await accepted(`cast-${index + 1}`, () => client.castBallot({ voterSecret: voterSecrets[index], selection: selections[index] })));
  const negativeClient = createNativeSdkClient(providers, { compiledAssetsPath: join(contracts, 'managed/native-election'), networkId: 'undeployed' });
  await negativeClient.join(client.contractAddress, client.configurationDigest);
  await rejectedBeforeSubmission('reject-invalid-choice', () => negativeClient.castBallot({ voterSecret: voterSecrets[0], selection: 3n }));
  await rejectedBeforeSubmission('reject-duplicate-credential', () => negativeClient.castBallot({ voterSecret: voterSecrets[0], selection: 0n }));
  for (const receipt of receipts) assert.equal((await client.checkReceipt(receipt)).receiptMatchesIndexedState, true);
  evidence.receipts = receipts.map(({ networkId, contractAddress, configurationDigest, index, receipt, txId, blockHeight }) => ({ networkId, contractAddress, configurationDigest, index, receipt, txId, blockHeight }));
  await save();
  await waitUntilChainTime(closesAt + 2, 'wait-for-voting-close');
  await accepted('close-voting', () => client.closeVoting());
  await rejectedBeforeSubmission('reject-wrong-trustee-share', () => client.submitDecryption(1n, (dealer.trustees[0].secretShare % (adapter.JUBJUB_SCALAR_ORDER - 2n)) + 1n));
  await accepted('trustee-1', () => client.submitDecryption(1n, dealer.trustees[0].secretShare));
  await accepted('trustee-3', () => client.submitDecryption(3n, dealer.trustees[2].secretShare));
  const totals = await client.recoverTally(1n, 3n); assert.deepEqual(totals, [2n, 1n, 2n]);
  await rejectedBeforeSubmission('reject-changed-tally', () => client.finalize(1n, 3n, [1n, 2n, 2n]));
  await accepted('finalize', () => client.finalize(1n, 3n, totals));
  const finalState = await client.refreshConfiguration();
  assert.equal(finalState.phase, 3n); assert.equal(finalState.accepted, 5n); assert.deepEqual(finalState.finalizedTotals, totals);
  evidence.observedTotals = totals.map(Number); evidence.acceptedBallots = 5; evidence.finalPhase = 3;
  // Negative submission: resubmit the exact previously finalized transaction.
  // A pipeline rejection alone is not reported as independently verified chain rejection.
  stage = 'replay-finalized-transaction';
  try {
    const replayId = await bounded(walletProvider.submitTx(lastSubmittedTransaction), 30_000);
    evidence.replay = { outcome: 'submission-returned-existing-transaction', txId: replayId, newAcceptanceVerified: false };
  } catch (error) { evidence.replay = { outcome: 'submission-pipeline-rejected', category: failureCategory(error), independentNetworkRejectionVerified: false }; }
  evidence.status = 'passed'; evidence.completedAt = new Date().toISOString(); delete evidence.currentStage;
  await save(); output({ status: 'passed', acceptedTransactions: evidence.acceptedTransactions.length,
    observedTotals: evidence.observedTotals, evidence: 'artifacts/local-devnet/network-evidence.json', independentlyVerifiedChainInclusion: false });
} catch (error) {
  evidence.status = 'failed'; evidence.failedStage = stage; evidence.failureCategory = failureCategory(error);
  await save(); output({ status: 'failed', stage, category: evidence.failureCategory,
    acceptedTransactions: evidence.acceptedTransactions.length, evidence: 'artifacts/local-devnet/network-evidence.json' });
  process.exitCode = 1;
} finally {
  if (walletProvider) await bounded(walletProvider.stop(), 20_000).catch(() => {});
  if (db) await bounded(db.close(), 20_000).catch(() => {});
  if (privateDirectory && dirname(resolve(privateDirectory)) === resolve(tmpdir()) && basename(privateDirectory).startsWith('midnight-ballot-devnet-')) {
    await rm(privateDirectory, { recursive: true, force: true }).catch(() => {});
  }
}
