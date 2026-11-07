import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { LACE_PROOF_COVERAGE_SOURCE as pin, projectLaceProofCoverage, verifyLaceProofCoverageSource } from '../../scripts/lace-proof-coverage.mjs';

const fixed = error => error.message === 'Lace proving function coverage could not be validated';
const record = (count = 1) => ({ result: [{ url: pin.url, scriptId: 'not-retained', functions: [{
  functionName: pin.functionName, isBlockCoverage: false,
  ranges: [{ startOffset: pin.startOffset, endOffset: pin.endOffset, count }],
}] }] });

test('coverage projection retains only the exact pinned function invocation count', () => {
  const input = record(3);
  input.result.unshift({ url: 'https://private.invalid/?withheld', functions: [{ functionName: 'unrelated' }] });
  input.result[1].functions.unshift({ functionName: 'prove', isBlockCoverage: false,
    ranges: [{ startOffset: 12, endOffset: 30, count: 900 }] });
  const before = JSON.stringify(input), result = projectLaceProofCoverage(input);
  assert.deepEqual(result, { matchedFunctions: 1, invocations: 3 });
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes('withheld'), false);
  assert.deepEqual(projectLaceProofCoverage(record(0)), { matchedFunctions: 1, invocations: 0 });
});

test('wrong URL, function or UTF-8 byte offset never establishes a matching invocation', () => {
  const wrongUrl = record(); wrongUrl.result[0].url += '?withheld';
  const wrongName = record(); wrongName.result[0].functions[0].functionName = 'check';
  const byteOffset = record(); byteOffset.result[0].functions[0].ranges[0].startOffset += 8;
  for (const value of [wrongUrl, wrongName, byteOffset, { result: [] }]) {
    assert.deepEqual(projectLaceProofCoverage(value), { matchedFunctions: 0, invocations: 0 });
  }
});

test('ambiguous ranges, block coverage and unbounded counts fail with fixed diagnostics', () => {
  const duplicate = record(); duplicate.result[0].functions.push(duplicate.result[0].functions[0]);
  const duplicateScript = record(); duplicateScript.result.push(duplicateScript.result[0]);
  const block = record(); block.result[0].functions[0].isBlockCoverage = true;
  const nested = record(); nested.result[0].functions[0].ranges.push({ startOffset: 786_700, endOffset: 786_750, count: 1 });
  const malformed = record(); malformed.result[0].functions[0].ranges = null;
  const oversized = { result: new Array(16_385).fill(null) };
  for (const value of [null, {}, duplicate, duplicateScript, block, nested, malformed, oversized,
    ...[-1, 0.5, NaN, Infinity, 1_000_001, '1'].map(record)]) {
    assert.throws(() => projectLaceProofCoverage(value), fixed);
  }
});

test('source verification rejects missing, truncated or same-size substituted public bytes', () => {
  for (const bytes of [null, 'withheld', new Uint8Array(10), new Uint8Array(pin.bytes)]) {
    assert.throws(() => verifyLaceProofCoverageSource(bytes), fixed);
  }
  assert.ok(Object.isFrozen(pin));
});

class HarmlessCoverageFixture { probe(value) { return value + 1; } }

test('real V8 method coverage uses the method name through closing brace in UTF-16 units', async () => {
  // Actual Profiler protocol against harmless local code only. This is not a
  // wallet, crypto operation or substitute evidence of signed Lace execution.
  const session = new Session(); session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    assert.equal(new HarmlessCoverageFixture().probe(2), 3);
    const coverage = await session.post('Profiler.takePreciseCoverage');
    const script = coverage.result.find(value => value.url === import.meta.url);
    const fn = script?.functions.find(value => value.functionName === 'probe');
    const source = await readFile(new URL(import.meta.url), 'utf8');
    const expected = 'probe(value) { return value + 1; }';
    assert.ok(fn?.isBlockCoverage === false && fn.ranges.length === 1, 'Actual V8 function-level coverage is required');
    assert.equal(fn.ranges[0].count, 1);
    assert.ok(source.slice(fn.ranges[0].startOffset, fn.ranges[0].endOffset) === expected,
      'Actual V8 range must match the complete method source');
  } finally {
    await session.post('Profiler.stopPreciseCoverage').catch(() => {});
    await session.post('Profiler.disable').catch(() => {});
    session.disconnect();
  }
});
