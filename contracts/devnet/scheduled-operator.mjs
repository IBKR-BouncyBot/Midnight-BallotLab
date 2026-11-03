/** External operator for the explicitly selected isolated local chain.
 * Actual SDK calls prove/submit; actual indexer responses confirm acceptance.
 * The contract does not wake itself, advance its clock or decrypt without shares.
 * Secret shares and provider errors must remain in the calling process.
 */
import { pairCoefficients, requireScalar } from '../native/adapter.mjs';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Scheduled operation timed out; submission outcome may be uncertain')), milliseconds);
  })]); }
  finally { clearTimeout(timer); }
}

/** Uses a pinned client and two real synthetic trustee shares, never public keys alone. */
export async function runScheduledNativeTally({
  client, indexerUrl, publicDataProvider, trustees,
  onStage = async () => {}, onWaiting = async () => {}, onAccepted = async () => {},
  afterClosed = async () => {}, beforeFinalize = async () => {},
}) {
  if (client?.networkId !== 'undeployed' || !client.contractAddress || !client.configurationDigest) {
    throw new Error('A configured isolated local native election is required');
  }
  const endpoint = new URL(indexerUrl);
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Scheduled synthetic custody is restricted to the local indexer');
  }
  if (!publicDataProvider || typeof publicDataProvider.watchForTxData !== 'function') throw new Error('Actual transaction confirmation provider required');
  if (!Array.isArray(trustees) || trustees.length !== 2) throw new Error('Exactly two registered trustee shares are required');
  const ordered = trustees.map(({ index, secretShare }) => ({ index, secretShare })).sort((a, b) => a.index < b.index ? -1 : 1);
  pairCoefficients(ordered[0].index, ordered[1].index);
  ordered.forEach(trustee => requireScalar(trustee.secretShare, 'scheduled trustee scalar'));
  const initial = await client.refreshConfiguration();
  if (![0n, 1n].includes(initial.phase)) throw new Error('Scheduled operator requires an election that has not closed');
  const opensAt = Number(initial.opensAt), closesAt = Number(initial.closesAt);
  if (!Number.isSafeInteger(opensAt) || !Number.isSafeInteger(closesAt) || opensAt < 0 || opensAt >= closesAt) {
    throw new Error('Native election schedule is not representable by this operator');
  }
  const startedAt = new Date().toISOString(), target = closesAt + 2;
  const readChainTime = async () => {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block { height timestamp } }' }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error('Scheduled indexer clock unavailable');
    const body = await response.json(), block = body.data?.block;
    if (body.errors || !Number.isSafeInteger(block?.timestamp) || block.timestamp <= 0
      || !Number.isSafeInteger(block?.height) || block.height < 1) throw new Error('Scheduled indexer clock response invalid');
    return { seconds: Math.floor(block.timestamp / 1000), height: block.height };
  };
  await onStage('wait-for-scheduled-close');
  const waitLimit = Date.now() + 4_000_000;
  let lastNotice = 0, clock;
  for (;;) {
    clock = await readChainTime();
    if (clock.seconds >= target && Math.floor(Date.now() / 1000) >= target) break;
    if (Date.now() >= waitLimit) throw new Error('Scheduled deadline wait timed out');
    if (Date.now() - lastNotice >= 30_000) {
      await onWaiting({ status: 'waiting-for-real-chain-time', target, indexedTime: clock.seconds, indexedBlockHeight: clock.height });
      lastNotice = Date.now();
    }
    await delay(3000);
  }
  const closedAfterIndexedTime = clock.seconds;
  const accepted = async (operation, callback) => {
    await onStage(operation);
    const result = await bounded(callback(), 360_000);
    if (typeof result?.txId !== 'string' || !/^[0-9a-f]+$/i.test(result.txId)) throw new Error('Scheduled call returned no public transaction identifier');
    const confirmation = await bounded(publicDataProvider.watchForTxData(result.txId), 60_000);
    if (confirmation.status !== 'SucceedEntirely') throw new Error('Scheduled transaction was not accepted successfully');
    await onAccepted({ operation, txId: result.txId, blockHeight: String(confirmation.blockHeight), status: confirmation.status });
  };
  // The generated contract checks the real deadline again during proving/submission.
  await accepted('close-voting', () => client.closeVoting());
  await afterClosed();
  for (const trustee of ordered) {
    await accepted(`trustee-${trustee.index}`, () => client.submitDecryption(trustee.index, trustee.secretShare));
  }
  const first = ordered[0].index, second = ordered[1].index;
  const totals = await client.recoverTally(first, second);
  await beforeFinalize(totals.slice());
  await accepted('finalize', () => client.finalize(first, second, totals));
  const finalState = await client.refreshConfiguration();
  if (finalState.phase !== 3n || finalState.finalizedTotals.length !== totals.length
    || finalState.finalizedTotals.some((value, index) => value !== totals[index])) throw new Error('Scheduled final state does not match recovered totals');
  return {
    mode: 'external-scheduled-operator', networkId: 'undeployed', startedAt,
    opensAt, closesAt, closedAfterIndexedTime, finishedAt: new Date().toISOString(),
    automaticCloseAndTally: true, onChainSelfExecution: false,
    trusteePair: [Number(first), Number(second)], totals: totals.map(Number),
    confirmationSource: 'configured-local-indexer', independentlyVerifiedChainInclusion: false,
  };
}
