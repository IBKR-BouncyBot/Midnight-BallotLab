# Midnight Ballot Lab continuation

## Goal and starting point

The user wants actual Midnight code, native cryptography in the browser, and source/frontend hosting on GitHub. Read `docs/CODEX_HANDOVER.md` and `docs/HANDOVER_VERIFICATION.md` before implementation. Baseline: 0.3.0, source commit `5882d228f11f8b2022ca3ee6ad29bd05eb88965d`.

This portable checkout contains no prior Git history or ChatGPT Sites binding. Use the repository selected by the user in the current environment. The handover files were added to a copy; the 58 baseline source files were preserved.

## Evidence and workflow

- Fresh native compilation, generated-runtime tests, browser/WASM checks and local circuit proofs have passed in this continuation. Read `docs/CONTINUATION_RESULTS.md` and the exact retained evidence for stage boundaries; do not infer compatibility from syntax checks or version pins.
- Install the official toolchain first; verify the current support matrix and the intended network. Start with the recorded pins, changing them only as a consistent, documented set.
- Run the actual compiler, generated-contract tests and demo, fix demonstrated failures, then bundle and exercise the real browser/WASM path.
- Root `npm test` covers local JavaScript and adapter logic, not generated native contracts.
- Root `npm run build` clears `dist/` and disables both browser builds. Run `npm --prefix contracts run build:browser:native` and `node scripts/build-network-browser.mjs` afterward.
- Do not fabricate generated bindings, proof keys, native test results or a dependency lockfile. Review and commit a real lockfile after installation.
- Missing native prerequisites must remain failures. Never substitute the legacy protocol or a mock and label it native.
- Separate emulator success, proof generation, network acceptance, independent public verification and GitHub deployment in reports.
- Keep the Midnight styling and existing regression coverage. Once verified, make native execution the main experience and retain any legacy path only with clear labeling.

## Contract boundaries to preserve

- Secret key setup belongs in the constrained `configureKeys` call, not unproved constructor private calculations.
- Keep canonical nonzero subgroup scalar checks. Jubjub subgroup arithmetic and Compact coordinate Field arithmetic use different moduli.
- Bind membership paths to voter secrets and the current frozen electorate root; enforce election nullifier uniqueness.
- Compute the full one-hot ciphertext inside the circuit. Do not accept opaque caller digests as ballot validation.
- Bind receipts to the exact election/configuration/ciphertext and compare them with the locally constructed ballot.
- Aggregate the complete accepted ciphertext set. Trustee contribution calls must use the frozen aggregate, with no arbitrary subset parameter.
- Require valid registered trustee contributions and bounded totals satisfying the correct pair equations.
- Public exports must exclude choices, randomness, secrets, private contexts and proofData.
- Authenticate initial state, contract code/verifier keys, key configuration, chain state and maintenance policy in the real integration. An indexer response alone is not independent chain verification.

## Scope and completion

Use a development/test environment for actual proving/network integration until a production deployment is explicitly requested. Do not store wallet seeds or secrets in source, browser bundles, Actions artifacts or documentation. The demo dealer is centralized and all browser demo roles share one process; preserve these disclosures.

Complete unblocked implementation and checks before requesting missing access details. The user selected `https://github.com/IBKR-BouncyBot/Midnight-BallotLab` and a fresh isolated local devnet with test funds. Actual deployment/transaction evidence and any remaining access requirement are recorded in `docs/CONTINUATION_RESULTS.md`. Do not treat a local-devnet address as a public-network deployment.

Completion requires real compiler/runtime/browser evidence, a truthful native UI, reviewed CI, and a successful deployment to the selected GitHub Pages target. If real network integration is still blocked, document the exact remaining service/access requirement and do not call the emulator an on-chain election.

Avoid unrelated changes. Do not present this research prototype as suitable for national elections without a separate security and operational assurance process.
