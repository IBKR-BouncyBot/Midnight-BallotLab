# GitHub execution — 3 November 2026

Actual Lace 2.5.0 / API 4.0.1 completed nine local `undeployed` application transactions (eight native calls), finalizing `[0,1,0,0,0]`. See [wallet compatibility](NATIVE_NETWORK.md#wallet-compatibility) and [retained evidence](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/tree/main/evidence/2026-11-03/lace-wallet). Hosted-origin, Preview and Preprod transactions remain untested; mainnet is blocked. Confirmation relies on the configured local indexer and does not independently verify consensus.

See the [privacy redaction note](PRIVACY_REDACTION.md) for the distinction between original tested commit identifiers and the subsequently cleaned repository history.

Version 0.6.1 passed its affected local gates after the copy, receipt-upload and timed-setup changes: seven native-browser scenarios, four network-browser cases, 46 boundary tests and packaging (55 references, 388 files). Coverage includes receipt JSON/text uploads and invalid/private/oversized-file rejection, five-voter setup at CPU slowdown ×12, real 15-second closing and frozen-browser resume after the deadline. A real Chromium test with five voters at CPU slowdown ×12 reproduced a 2,621 ms setup failure; [the report](../evidence/2026-11-03/v0.6.1/timed-setup-before-fix.json) retains the failing bundle hash. The [after-fix diagnostic](../evidence/2026-11-03/v0.6.1/timed-setup-after-fix.json) passed the full real 60-second flow with five voters and CPU slowdown ×12 throughout: setup took 3,749 ms, followed by a ballot and automatic two-trustee finalization, with zero browser errors or remote requests. The first network-browser run's stale wording assertion failed; its report remains retained, and the corrected assertion passed all four cases on rerun. Hosted compatibility and Pages deployment passed for 0.6.1 at `fa94c3a19b4791441208ceae54a121faff2c588b`; its devnet acceptance also passed with 17 accepted transactions and automatic closing/tallying by the external operator.

## Version 0.6.1 hosted execution

Commit `fa94c3a19b4791441208ceae54a121faff2c588b` is the source for these runs:

| Workflow | GitHub run | Recorded state |
| --- | --- | --- |
| Midnight contract compatibility | [41699886738](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699886738) | **Success.** Full native compilation; 40 native, 26 isolated-runtime, 46 boundary and three provider cases; eight proofs across all seven circuits; seven native-browser and four network-browser cases passed. |
| Deploy GitHub Pages | [41699843307](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699843307) | **Success.** Compiler/runtime/browser gates, packaging (55 references, 404 files) and Pages deployment completed. |
| Local devnet transaction acceptance | [41699843169](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699843169) | **Success.** Seventeen accepted transactions, 16 completed proof transactions, five ballots, automatic external closing/tallying and final phase 3 totals `[2,1,2,0,0]` at block 137. |

The compatibility runner recorded Node **24.22.1**, npm **11.19.1** and Python **3.12.15**. Pages recorded Node **24.22.2**, npm **11.19.1** and Python **3.12.16**. Native versions remain Compact devtools **0.5.1**, compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1** and proof-server **8.1.3**; the actual browser suites used Playwright **1.64.1** and Chromium **156.0.8078.4**.

The [compatibility provenance](../evidence/2026-11-03/v0.6.1/github/native/provenance.json) records artifact `13262939076`, archive SHA-256 `68d3aac567c652716871881b260662d5db67941c82192b1ca0f34f6826c96b61`, and 23 retained files. The [Pages provenance](../evidence/2026-11-03/v0.6.1/github/pages/provenance.json) records artifact `13262832883`, archive SHA-256 `ce7b5973dd497035bee84e53e953d45f78b122139ace7fffaaa7ea7cac7bfda0`, and 18 retained files. Exact command output and public reports are retained alongside each manifest.

The 0.6.1 [devnet run 41699843169](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699843169) passed on its fresh isolated `undeployed` chain from **19:07:32.051 to 19:21:09.753 UTC**. All **17 transactions** were confirmed `SucceedEntirely` by the configured local indexer; **16 proof transactions** completed, five ballots and receipts matched, and final phase 3 contained padded totals `[2,1,2,0,0]` at block **137**. Four invalid operations were rejected before proof/submission. The replay attempt was rejected by the submission pipeline; independent network rejection of that replay remains unverified.

The external scheduled operator read the actual closing deadline `1793733574`, waited until indexed time `1793733576`, then submitted closing, trustee contributions **1 + 3**, and finalization. Its report records `automaticCloseAndTally: true` and `onChainSelfExecution: false`. The chain did not run itself; the separate operator used actual wallet, prover and indexer services.

The [public transaction report](../evidence/2026-11-03/v0.6.1/github/devnet/reports/network-evidence.json) retains all transaction IDs, source hashes and confirmation limits:

- Contract address: `c15231e6160d7c4b708a070585ae780941e6d486381540e2a1227dc0e92f61f5`.
- Configuration digest: `6b08f93465ce4e8bb4418e561c752f262a04514a1cd895f8f78959916bfd8ea2`.
- Finalization: `005447c309a6e35d7c8d9f8c2e049b2c70070dc022b6b5d048d1f3241674f28ea7`, block `137`.

The [devnet provenance](../evidence/2026-11-03/v0.6.1/github/devnet/provenance.json) records artifact `13263408473`, archive SHA-256 `fcc73e6ad64014fd775a4ed8f16ded09e878ce9a370a750935c2ed5f6e13c7e1` and 16 retained files. Its runner used Node **24.22.1**, npm **11.19.1** and Python **3.12.15**. Browser-wallet testing remains false in that Node run; independently authenticated chain inclusion remains unverified.

The 0.6.1 frontend was deployed to [Midnight Ballot Lab](https://ibkr-bouncybot.github.io/Midnight-BallotLab/). Its browser evidence comes from real Chromium on the CI runners; no new direct test of the hosted origin is claimed. Proof generation, network confirmation and browser-wallet validation remain separate evidence stages.

## Version 0.6.0 local verification

Version 0.6.0 passed local verification and hosted compatibility/Pages deployment. Its seven-circuit full compilation, combined 40-case native suite (26 generated-contract and 14 public-verifier cases), 26 isolated-graph runtime cases, 46 boundary cases and five-lane example passed locally. Eight real proofs across all seven circuit types also passed. All seven native-browser cases and four network-browser cases passed after correcting mobile layout; the native cases include fresh-session imports, every receipt, all three trustee pairs, real-clock scheduling and Chromium freeze/resume. Static packaging passed (57 references, 310 files). Hosted compatibility and Pages deployment passed at commit `3839a91eeb9079bcb05d74d86ede27d03eb53d45`; the devnet run failed before a complete election. Its failure evidence is retained separately. No new hosted-origin browser test is claimed. A copied public snapshot supports consistency checks, not authenticated proof or fairness claims.

## Version 0.6.0 hosted execution

Commit `3839a91eeb9079bcb05d74d86ede27d03eb53d45` is the source for these runs:

| Workflow | GitHub run | Recorded state |
| --- | --- | --- |
| Midnight contract compatibility | [41695611384](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695611384) | **Success.** Native compilation; 40 native, 26 isolated-runtime, 46 boundary and three provider cases; eight proofs across all seven circuits; seven native-browser and four network-browser cases passed. |
| Deploy GitHub Pages | [41695345239](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695345239) | **Success.** Required compiler/runtime/browser gates and deployment completed. |
| Local devnet transaction acceptance | [41695367454](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695367454) | **Failed at `cast-5`.** Twelve accepted transactions included four ballots; the fifth ballot remained unconfirmed. Closing, trustee submissions and finalization were not reached. |

The compatibility runner used Node **24.22.1**, npm **11.19.1** and Python **3.12.15**. The Pages runner used Node **24.22.2**, npm **11.19.1** and Python **3.12.16**. Both retain Compact devtools **0.5.1**, compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, Playwright **1.64.1** and Chromium **156.0.8078.4**. Actual standalone proving used proof-server **8.1.3**.

The [compatibility provenance](../evidence/2026-11-03/v0.6.0/github/native/provenance.json) records artifact `13261181287`, SHA-256 `9d6ad1833a98456a8ec8c39870d8db211beeb844771cbe9549364ba19010131f`, and 23 retained files. The [Pages provenance](../evidence/2026-11-03/v0.6.0/github/pages/provenance.json) records artifact `13260543193`, SHA-256 `04e97e7ef4dc97c13f088458acce6c3e4021d92934c286a0c05ff238810b0d5c`, and 18 retained files. Their command outputs and public reports are retained alongside the manifests. The deployed frontend is [Midnight Ballot Lab](https://ibkr-bouncybot.github.io/Midnight-BallotLab/). Browser evidence for this revision comes from actual Chromium on the CI runners; no new direct test of the hosted origin is claimed.

The initial compatibility [run 41695362560](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695362560) failed at toolchain installation because the GitHub API was rate-limited. Its [failure record](../evidence/2026-11-03/v0.6.0/github-initial-install-failure.json) and [installer output](../evidence/2026-11-03/v0.6.0/github-toolchain-rate-limit.log) are retained separately. The successful run above tested the same source commit; the initial failure is not relabeled as passing. The [devnet provenance](../evidence/2026-11-03/v0.6.0/github/devnet/provenance.json) records artifact `13260579055`, archive SHA-256 `3f9ce08128a67365a25595606f8d371e4b9323310647a8ff3fd6bca36438b678`. Its [public failure report](../evidence/2026-11-03/v0.6.0/github/devnet/reports/network-evidence.json) retains 12 accepted transactions, four accepted ballots, 12 completed proof transactions and an unconfirmed fifth-ballot submission. No final tally or successful scheduled network operator is claimed. The runner's voting window has been extended from four to eight minutes, retaining the four-minute opening/enrollment lead time. Version 0.6.1 subsequently passed the full acceptance run documented above. All completed outcomes retain their exact commit and artifact provenance.

## Version 0.5.0 local verification

Version 0.5.0 passed fresh local compilation, 45 native boundary tests, 20 generated-contract tests, three provider API tests, the five-ballot example, both browser builds, five updated native-browser cases and four network-browser cases. The native-browser cases exercise clickable ballots, keyboard controls, all trustee pairs, exactly-two selection, reset, mobile layout and fail-closed behavior. Public evidence is retained under [`evidence/2026-11-03/v0.5.0/`](../evidence/2026-11-03/v0.5.0/). The hosted records below apply to their exact named commits.

## Version 0.5.0 hosted execution

Commit `a904ea5c1688952fe3bfd459e51e9a1cf49db436` is the source for these runs:

| Workflow | GitHub run | Recorded state |
| --- | --- | --- |
| Midnight contract compatibility | [41689471487](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689471487) | **Success.** Native compilation, 45 boundary tests, 20 generated native tests, 20 isolated-graph tests, three provider API cases, eight real circuit proofs and both browser suites passed. |
| Deploy GitHub Pages | [41689472206](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689472206) | **Success.** Build, native/browser gates and Pages deployment completed. |
| Local devnet transaction acceptance | [41689476184](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689476184) | **Success.** Seventeen accepted transactions, 16 completed proof transactions, five matching receipts and four pre-submission negative checks; final phase 3, tally `[2,1,2]`, block 98. |

The compatibility/Pages environment recorded Node **24.22.2**, npm **11.19.1** and Python **3.12.16**. Compact devtools **0.5.1**, compiler **0.31.1**, runtime **0.16.0**, Midnight.js **4.1.1**, proof-server **8.1.3**, Playwright **1.64.1** and Chromium **156.0.8078.4** retain their reviewed versions. The standalone proof report contains eight proof responses across all seven circuit types, with negative checks and no network submission.

The [compatibility provenance](../evidence/2026-11-03/v0.5.0/github/native/provenance.json) records artifact `13256677151`, archive SHA-256 `e9c47f8a795dc0e86fe2de83c43316cdee97073e5eac093a2d0a002dcda79b37`. The [Pages build provenance](../evidence/2026-11-03/v0.5.0/github/pages/provenance.json) records artifact `13255517853`, archive SHA-256 `d8c14841e305b11adadd1f28f0f5adb40516d558074f1dd788e0548737f32b09`. The [devnet provenance](../evidence/2026-11-03/v0.5.0/github/devnet/provenance.json) records artifact `13256184734`, archive SHA-256 `8a68bbe62131834b3e30f5154206bc65794a2704dcac5ba265cecb591b4b3aec`. Its actual wallet run began at 18:01:37.620 UTC and completed at 18:11:22.157 UTC, reporting Node 24.22.1. Its [public report](../evidence/2026-11-03/v0.5.0/github/devnet/reports/network-evidence.json) contains the exact contract address, configuration digest and all 17 accepted transaction IDs. Confirmation is from the configured local indexer; independent chain inclusion and browser-wallet validation remain false in that Node run. Exact command output, source and artifact hashes, and public reports are retained alongside those manifests. The completed deployment serves [Midnight Ballot Lab](https://ibkr-bouncybot.github.io/Midnight-BallotLab/). This revision passed real browser tests on the CI runner; a new direct browser test at the deployed origin is not claimed.

## Commit-specific execution records

The hosted source is [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab) on `main`. The completed runs below tested commit `b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`. GitHub Pages uses GitHub Actions as the build source. Local commands have their own evidence in [CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md).

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
- Confirmation source: `configured-local-indexer`; independently verified chain inclusion and browser-wallet testing remain false in that Node run.

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
- The network browser page's real SDK loading and failure-handling tests do not establish a transaction through an actual browser wallet. The separate local Lace browser-wallet election passed.

Only public evidence is retained: tool versions, source and dependency hashes, compiler/test results, proof hashes and byte counts, public transaction identifiers and public browser artifacts. Private choices, randomness, trustee secrets, proof preimages, witness data and wallet databases are excluded.
