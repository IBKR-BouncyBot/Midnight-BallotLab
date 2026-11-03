# Handover verification — 3 November 2026

This report distinguishes checks performed while creating this bundle from the earlier application-release tests. No application implementation was changed for this handover.

## Fresh checks for this bundle

- Read the repository HEAD: 5882d228f11f8b2022ca3ee6ad29bd05eb88965d; working tree was clean.
- Compared all 58 entries of the existing portable source archive byte-for-byte with the corresponding current source files. All matched.
- Recomputed the baseline archive SHA-256: 6a3e8b944f9a10b6e5d3f7275a9142c8ec53531ea7b281a6569808d175485d43.
- Extracted that portable source into a separate staging directory; the existing project was not modified.
- Ran `npm run build` on the copied baseline: exit 0, 58 source files packaged.
- Ran `python3 scripts/check_pages.py` on that copied baseline: exit 0, 19 local references checked, root and repository-subdirectory URL forms passed, nativeMode reported unavailable.
- Confirmed absence of installed contract dependencies, the generated native contract, native browser bundle and contract dependency lockfile.
- Added only three project handover files: AGENTS.md, docs/CODEX_HANDOVER.md and this report. Source build output was excluded from the continuation ZIP.
- Checked final ZIP integrity, complete required source/workflow presence, per-file checksums and exact preservation of the 58 baseline files. The included verify_bundle.py independently repeats the per-file hash comparison.

These checks establish source-transfer and baseline static-packaging integrity. They do not execute the native compiler, native runtime, browser, proof system, network or GitHub deployment.

## Earlier release results, not rerun for this handover

The supplied docs/VERIFICATION.md records:

- 95 local tests passed in a full run, zero failed or skipped.
- Three additional native-loader tests passed afterward.
- The existing synthetic-DOM browser workflow was rerun separately.
- Native input/projection tests and an abstract threshold-algebra model passed. These do not execute Compact or Jubjub.
- JavaScript syntax and source/markup checks passed.
- The native receipt format's maximum 182-character QR text fit the QR encoder. No camera scan was performed.

The repository now contains 98 local test cases across the root suite. This handover did not rerun that full suite and does not contain a new full-suite log.

## Native stages still unverified

The 20 new native-election cases and 11 admission-starter cases require actual generated contract output and runtime. None executed successfully in the preceding environment.

Earlier attempts failed at missing prerequisites:
- Compact compile: executable unavailable (compact ENOENT).
- Native demo: compact-runtime package unavailable.
- Native browser bundle: generated contract output unavailable.

The preceding environment also reported HTTP 403 when trying to retrieve the required toolchain/packages. That is an environment limitation; it is not evidence that the code compiles elsewhere. The new Codex environment must attempt installation and record the actual result.

No native ZK proofs, Midnight transactions, wallet/provider integration tests, browser/WASM execution, GitHub workflow runs or GitHub Pages deployment are claimed. The prior privately hosted page was a static demonstration and is not included as evidence of native operation.

## Integrity scope

SHA256SUMS.txt covers every bundled file except itself. The original portable archive's digest and original-file hashes are recorded in BUNDLE_MANIFEST.json. verify_bundle.py checks path safety, missing files, changed bytes and unexpected files (except harmless Python cache output).

Hashes distributed in the same ZIP detect accidental changes against the included record; they do not provide an independent trust anchor or establish the source's cryptographic security.

