/** CI-only projection of precise coverage for one signed public Lace method.
 * Invocation coverage is not proof completion or cryptographic attestation.
 * Never return unrelated URLs, function names, ranges or coverage records.
 */
import { createHash } from 'node:crypto';

export const LACE_PROOF_COVERAGE_SOURCE = Object.freeze({
  path: 'js/3267.js',
  url: 'chrome-extension://gafhhkghbfjjkeiendhlofajokpaflmk/js/3267.js',
  bytes: 816_015,
  sha256: 'f021b27a0b98661b49b261b32fa3933dc4a50c58ac5825fdf93fe26182102b56',
  utf16Length: 816_007,
  functionName: 'prove',
  // CDP uses UTF-16 offsets, not UTF-8 byte offsets (which are eight larger here).
  startOffset: 786_651,
  endOffset: 786_854,
});
const methodSource = 'prove(t,e,r){const n=passStringToWasm0(e,w.__wbindgen_malloc,w.__wbindgen_realloc);const s=h;const o=w.wrappedprovingprovider_prove(this.__wbg_ptr,t,n,s,isLikeNone(r)?0:addToExternrefTable0(r));return o}';
const MAX_INVOCATIONS = 1_000_000;
function fail() { throw new Error('Lace proving function coverage could not be validated'); }

export function verifyLaceProofCoverageSource(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== LACE_PROOF_COVERAGE_SOURCE.bytes) fail();
  if (createHash('sha256').update(bytes).digest('hex') !== LACE_PROOF_COVERAGE_SOURCE.sha256) fail();
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(); }
  if (source.length !== LACE_PROOF_COVERAGE_SOURCE.utf16Length
      || source.slice(LACE_PROOF_COVERAGE_SOURCE.startOffset, LACE_PROOF_COVERAGE_SOURCE.endOffset) !== methodSource
      || source.indexOf(methodSource) !== LACE_PROOF_COVERAGE_SOURCE.startOffset
      || source.indexOf(methodSource, LACE_PROOF_COVERAGE_SOURCE.startOffset + 1) !== -1) fail();
  return LACE_PROOF_COVERAGE_SOURCE;
}

export function projectLaceProofCoverage(value) {
  if (!value || !Array.isArray(value.result) || value.result.length > 16_384) fail();
  let matchedFunctions = 0, invocations = 0, matchingScripts = 0;
  for (const script of value.result) {
    if (script?.url !== LACE_PROOF_COVERAGE_SOURCE.url) continue;
    if (++matchingScripts > 1 || !Array.isArray(script.functions) || script.functions.length > 16_384) fail();
    for (const fn of script.functions) {
      if (fn?.functionName !== LACE_PROOF_COVERAGE_SOURCE.functionName) continue;
      if (!Array.isArray(fn.ranges) || fn.ranges.length < 1 || fn.ranges.length > 4_096) fail();
      const range = fn.ranges[0];
      // Other classes in the same bundle also have a method named prove.
      if (range?.startOffset !== LACE_PROOF_COVERAGE_SOURCE.startOffset
          || range?.endOffset !== LACE_PROOF_COVERAGE_SOURCE.endOffset) continue;
      if (++matchedFunctions > 1 || fn.isBlockCoverage !== false || fn.ranges.length !== 1
          || !Number.isSafeInteger(range.count) || range.count < 0 || range.count > MAX_INVOCATIONS) fail();
      invocations = range.count;
    }
  }
  return Object.freeze({ matchedFunctions, invocations });
}
