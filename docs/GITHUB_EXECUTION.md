# GitHub execution — 3 November 2026

Version 0.6.0 is undergoing fresh verification. Its seven-circuit full compilation, combined 40-case native suite (26 generated-contract and 14 public-verifier cases), 26 isolated-graph runtime cases, 46 boundary cases and five-lane example passed locally. Eight real proofs across all seven circuit types also passed. All seven native-browser cases and four network-browser cases passed after correcting mobile layout; the native cases include fresh-session imports, every receipt, all three trustee pairs, real-clock scheduling and Chromium freeze/resume. Static packaging passed (57 references, 310 files). Network acceptance and hosted CI/deployment for this revision remain pending; no new hosted-origin browser test is claimed. A copied public snapshot supports consistency checks, not authenticated proof or fairness claims.

Version 0.5.0 passed fresh local compilation, 45 native boundary tests, 20 generated-contract tests, three provider API tests, the five-ballot example, both browser builds, five updated native-browser cases and four network-browser cases. The native-browser cases exercise clickable ballots, keyboard controls, all trustee pairs, exactly-two selection, reset, mobile layout and fail-closed behavior. Public evidence is retained under [`evidence/2026-11-03/v0.5.0/`](../evidence/2026-11-03/v0.5.0/). The hosted records below apply to their exact named commits.

## Version 0.5.0 hosted execution

Commit [`a904ea5c1688952fe3bfd459e51e9a1cf49db436`](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/commit/a904ea5c1688952fe3bfd459e51e9a1cf49db436) is the source for these runs:

| Workflow | GitHub run | Recorded state |
| --- | --- | --- |
| Midnight contract compatibility | [41689471487](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689471487) | **Success.** Native compilation, 45 boundary tests, 20 generated native tests, 20 isolated-graph tests, three provider API cases, eight real circuit proofs and both browser suites passed. |
| Deploy GitHub Pages | [41689472206](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689472206) | **Success.** Build, native/browser gates and Pages deployment completed. |
| Local devnet transaction acceptance | [41689476184](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689476184) | **Success.** Seventeen accepted transactions, 16 completed proof transactions, five matching receipts and four pre-submission negative checks; final phase 3, tally `[2,1,2]`, block 98. |

The compatibility/Pages environment recorded Node **24.22.2**, npm **11.19.1** and Python **3.12.16**. Compact devtools **0.5.1**, compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, proof-server **8.1.3**, Playwright **1.64.1** and Chromium **156.0.8078.4** retain their reviewed versions. The standalone proof report contains eight proof responses across all seven circuit types, with negative checks and no network submission.

The [compatibility provenance](../evidence/2026-11-03/v0.5.0/github/native/provenance.json) records artifact `13256677151`, archive SHA-256 `e9c47f8a795dc0e86fe2de83c43316cdee97073e5eac093a2d0a002dcda79b37`. The [Pages build provenance](../evidence/2026-11-03/v0.5.0/github/pages/provenance.json) records artifact `13255517853`, archive SHA-256 `d8c14841e305b11adadd1f28f0f5adb40516d558074f1dd788e0548737f32b09`. The [devnet provenance](../evidence/2026-11-03/v0.5.0/github/devnet/provenance.json) records artifact `13256184734`, archive SHA-256 `8a68bbe62131834b3e30f5154206bc65794a2704dcac5ba265cecb591b4b3aec`. Its actual wallet run began at 18:01:37.620 UTC and completed at 18:11:22.157 UTC, reporting Node 24.22.1. Its [public report](../evidence/2026-11-03/v0.5.0/github/devnet/reports/network-evidence.json) contains the exact contract address, configuration digest and all 17 accepted transaction IDs. Confirmation is from the configured local indexer; independent chain inclusion and browser-wallet validation remain false. Exact command output, source and artifact hashes, and public reports are retained alongside those manifests. The completed deployment serves [Midnight Ballot Lab](https://ibkr-bouncybot.github.io/Midnight-BallotLab/). This revision passed real browser tests on the CI runner; a new direct browser test at the deployed origin is not claimed.

## Commit-specific execution records

The hosted source is [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab) on `main`. The completed runs below tested commit [`b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/commit/b33b6e4896a12d211cc9b0040acdaf01c5a89ac5). GitHub Pages uses GitHub Actions as the build source. Local commands have their own evidence in [CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md).

## Hosted runs

| Workflow | GitHub run | Recorded state |
| --- | --- | --- |
| Deploy GitHub Pages | [41684485038](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684485038) | **Success.** Native compilation, 20 generated native tests, three provider API cases, the native example, both real browser suites and Pages deployment passed. |
| Midnight contract compatibility | [41684474674](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684474674) | **Success.** Native compilation, 20 generated native and 20 isolated-graph runtime tests passed; eight actual proofs across seven circuits, negative checks and both browser suites passed. |
| Local devnet transaction acceptance | [41684480267](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684480267) | **Success.** Seventeen transactions confirmed `SucceedEntirely`, 16 completed proof transactions, five matching receipts, four pre-submission negative checks and final tally `[2,1,2]` at block 99. |

All three runs completed successfully against the named commit. These are actual GitHub Actions runs, separate from local workflow syntax checks; their results remain bound to that source.

The successful hosted jobs used Node **24.22.1**, npm **11.19.1** and Python **3.12.15**, distinct from the earlier Windows tool versions. They installed Compact devtools **0.5.1**, compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, Playwright **1.64.1** and Chromium **156.0.8078.4** from the reviewed installation path and dependency locks. The compatibility job used proof-server **8.1.3** for the standalone proofs. Exact command output and public reports are retained under `evidence/2026-11-03/github/native/` and `pages/`.

The [Pages provenance](../evidence/2026-11-03/github/pages/provenance.json) records artifact ID `13254448147`, archive SHA-256 `628bd9f6745a5e1e007bdacc3f32051d5bd411d114e08b99b8c7597605a96b7b`, commit and per-file hashes. The [compatibility provenance](../evidence/2026-11-03/github/native/provenance.json) records artifact ID `13253668336` and archive SHA-256 `c9e94d85dc4a052be0f11fb8268e162e501e08b3fb90f6aab81187598bd134bd` with the corresponding commit and retained-file hashes.

## Hosted isolated-devnet outcome

The hosted election ran from 17:30:37.851 to 17:40:27.816 UTC on 3 November 2026. Its own fresh `undeployed` development chain has different addresses and block heights from the earlier local machine run. The configured local indexer confirmed deployment, key configuration, five enrollments, opening, five ballots, closing, two trustee contributions and finalization. The final phase was 3. Invalid choice, duplicate credential, wrong trustee share and changed tally were rejected before proof/submission. Replay was rejected by the submission pipeline; independent network rejection of replay remains unverified.

The [hosted transaction report](../evidence/2026-11-03/github/devnet/reports/network-evidence.json) contains all 17 public transaction IDs, block heights, source hashes and exact versions:

- Contract address: `1bfb30957c3f4ea6cb6e98c8315501fb0c690ce8e6d0696434be322c34b21e71`.
- Configuration digest: `83a7af203b51cb44dc3c266c6f5a18402cb97893b6810c94243e985e2136e72b`.
- Finalization transaction: `00f3637b205c343e1b50f997f84fe8f6ed7059cff9e1cbabb928cfbc51d56b9589`, block `99`.
- Confirmation source: `configured-local-indexer`; independently verified chain inclusion and browser-wallet testing remain false.

The [devnet provenance](../evidence/2026-11-03/github/devnet/provenance.json) records artifact ID `13255237907` and archive SHA-256 `17ba09940b51b6b42387b189427e8488fae8fd72aa37d961f9c681e36972b836`. The workflow stopped and removed its labeled services after execution. This temporary CI chain is not persistent public network infrastructure.

## Direct HTTPS browser evidence

A real Chromium run against [the actual HTTPS project URL](https://ibkr-bouncybot.github.io/Midnight-BallotLab/) passed three cases on 3 November 2026, beginning at 17:33:41.358 UTC, for commit `b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`. The 0.5.0 deployment and runner-local browser results are recorded in their own section above. The direct HTTPS run checked:

- Thirty HTTP asset checks passed, including the three served WASM assets and 21 generated circuit assets. Served manifests, content-addressed WASM, bundle digests, MIME types and response headers were retained.
- The native election accepted five synthetic ballots locally; trustees 1 and 3 finalized `[2,1,2]`. The rendered QR decoded, receipt JSON round-tripped, an altered receipt was rejected and public exports met their allowlist. A 390-pixel mobile viewport was exercised.
- The network page loaded the real SDK and two WASM modules. With no wallet installed it kept transaction actions disabled and produced no transaction events.

Both browser flows recorded zero page errors, console errors and off-site requests. The report is `artifacts/deployed-browser/evidence.json`, with the public report, snapshot and network-page screenshot retained under `evidence/2026-11-03/github/live/`. This verifies the deployment and local browser cryptography at the recorded commit; its evidence explicitly records `walletConnected`, `proofGeneration`, `networkSubmission` and `chainInclusionVerified` as false.

Pages serves the static frontend and its generated native WASM assets. It does not deploy the Midnight contract or host a node, indexer or prover. ChatGPT Sites is not involved.

## Evidence boundaries

- The main browser experience executes the actual generated contract and native cryptography locally. Its successful election flow does not generate a network proof or submit a transaction.
- The compatibility run requests standalone real circuit proofs from the pinned local proof server. It does not submit them as network transactions or independently verify the resulting proofs.
- The separate devnet run creates an isolated local `undeployed` chain, uses the real wallet/prover/indexer/submission path and requires accepted transaction outcomes. Configured-indexer confirmations do not independently authenticate canonical chain inclusion.
- The network browser page's real SDK loading and failure-handling tests do not establish a transaction through an actual browser wallet. That browser-wallet path remains unvalidated.

Only public evidence is retained: tool versions, source and dependency hashes, compiler/test results, proof hashes and byte counts, public transaction identifiers and public browser artifacts. Private choices, randomness, trustee secrets, proof preimages, witness data and wallet databases are excluded.
