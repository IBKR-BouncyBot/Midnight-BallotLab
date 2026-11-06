import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Only public block metadata is requested. This script never opens a wallet,
// generates a proof, submits a transaction, follows a redirect or sends auth.
const ENDPOINTS = Object.freeze([
  Object.freeze({
    id: 'lace-builtin-preview-indexer',
    url: 'https://blockfrost.lw.iog.io/midnight-preview/',
  }),
  Object.freeze({
    id: 'official-preview-indexer',
    url: 'https://indexer.preview.midnight.network/api/v4/graphql',
  }),
]);
const QUERY = '{ block { height timestamp } }';
const MAX_RESPONSE_BYTES = 64 * 1024;
const TIMEOUT_MS = 15_000;

async function readPublicJson(response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    return { category: 'response-too-large' };
  }
  if (!response.body) return { category: 'invalid-response' };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { category: 'response-too-large' };
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { category: 'invalid-response' };
    if (Array.isArray(body.errors) && body.errors.length > 0) return { category: 'graphql-errors' };
    const block = body.data?.block;
    if (!block || !Number.isSafeInteger(block.height) || block.height < 0 ||
        !Number.isSafeInteger(block.timestamp) || block.timestamp < 0 ||
        block.timestamp > 8_640_000_000_000_000) {
      return { category: 'invalid-response' };
    }
    return {
      category: 'healthy',
      block: {
        height: block.height,
        timestampMilliseconds: block.timestamp,
        timestampUtc: new Date(block.timestamp).toISOString(),
      },
    };
  } catch {
    return { category: 'invalid-response' };
  }
}

async function probe(endpoint) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const result = {
    id: endpoint.id,
    endpoint: endpoint.url,
    serverOrigin: new URL(endpoint.url).origin,
    startedAt,
    finishedAt: null,
    elapsedMilliseconds: 0,
    httpStatus: null,
    category: 'transport-error',
    block: null,
  };
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY }),
      credentials: 'omit',
      redirect: 'manual',
      signal,
    });
    result.httpStatus = response.status;
    if (response.status !== 200) {
      result.category = 'http-status';
      await response.body?.cancel();
    } else {
      Object.assign(result, await readPublicJson(response));
    }
  } catch {
    result.category = signal.aborted ? 'timeout' : 'transport-error';
  }
  result.finishedAt = new Date().toISOString();
  result.elapsedMilliseconds = Math.round(performance.now() - start);
  return result;
}

async function main() {
  const sourceCommit = execFileSync('git', [
    '-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'rev-parse', 'HEAD',
  ], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  }).trim();
  const inCi = process.env.GITHUB_ACTIONS === 'true';
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) ||
      (inCi && (process.env.GITHUB_SHA !== sourceCommit || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '')))) {
    throw new Error('invalid-source-metadata');
  }
  const output = inCi
    ? path.join(process.env.RUNNER_TEMP ?? '', 'preview-service-diagnostic.json')
    : path.resolve('artifacts/preview-service-diagnostic/local-report.json');
  if (inCi && !path.isAbsolute(process.env.RUNNER_TEMP ?? '')) throw new Error('invalid-output-directory');
  const report = {
    schema: 'midnight-ballot-lab/public-preview-service-diagnostic/v1',
    status: 'completed',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    executionEnvironment: inCi ? 'github-actions' : 'local-node',
    sourceCommit,
    diagnosticScriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
    runId: inCi ? process.env.GITHUB_RUN_ID : null,
    nodeVersion: process.version,
    networkId: 'preview',
    query: QUERY,
    timeoutMilliseconds: TIMEOUT_MS,
    maximumResponseBytes: MAX_RESPONSE_BYTES,
    authenticationSent: false,
    redirectsFollowed: false,
    walletAccessed: false,
    proofsRequested: false,
    transactionsSubmitted: false,
    hostedApplicationRequested: false,
    rawResponseBodiesRetained: false,
    scope: 'One public GraphQL block query per fixed endpoint from this host; not a wallet synchronization, subscription, proof or transaction test.',
    endpoints: [],
    allEndpointsHealthy: false,
  };
  for (const endpoint of ENDPOINTS) report.endpoints.push(await probe(endpoint));
  report.allEndpointsHealthy = report.endpoints.every(item => item.category === 'healthy');
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    status: report.status,
    allEndpointsHealthy: report.allEndpointsHealthy,
    sourceCommit,
    endpoints: report.endpoints.map(({ id, httpStatus, category }) => ({ id, httpStatus, category })),
  }));
  if (!report.allEndpointsHealthy) process.exitCode = 1;
}

main().catch(() => {
  console.error(JSON.stringify({ status: 'failed', category: 'diagnostic-unavailable' }));
  process.exitCode = 1;
});
