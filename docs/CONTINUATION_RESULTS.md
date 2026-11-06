# Native execution evidence — 3 November 2026

Actual Lace 2.5.0 / API 4.0.1 completed nine local `undeployed` application transactions (eight native calls), finalizing `[0,1,0,0,0]`. See [wallet compatibility](NATIVE_NETWORK.md#wallet-compatibility) and [retained evidence](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/tree/main/evidence/2026-11-03/lace-wallet). A separate [Node Wallet SDK run on public Preview](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/blob/main/evidence/2026-11-06/public-preview-sdk/election-acceptance.json) completed nine accepted application transactions and eight proved contract calls. Browser-wallet transactions on Preview, wallet connection or transactions from the hosted GitHub Pages origin, and Preprod transactions remain untested; mainnet is blocked. Each run relies on its configured indexer and does not independently verify consensus.

This report summarizes completed native-contract, proving, network and browser runs. It describes the tested source recorded in the linked reports, not unverified changes.

## Browser-worker circuit proofs — 6 November 2026

A real browser run from a local application origin passed **eight official WASM proofs across all seven generated native circuits**, from **18:19:23.735 to 18:24:47.551 UTC**. The [public report](../evidence/2026-11-06/browser-wasm/attempt-2/browser-report.json) records actual constraint checks and proof bytes/hashes for configuration, enrollment, opening, casting, closing, two trustee contributions and finalization, plus rejection of a wrong trustee share and a mismatched preimage/circuit location. It used Compact 0.31.1, compact-runtime 0.16.0, Midnight.js 4.1.1 and ZKIR 2.1.1. Synthetic witnesses stayed in browser memory; only public summaries were retained.

This proves application-circuit proof generation in the dedicated browser worker. No wallet or HTTP proof provider was used, no transaction was submitted, and the result does not establish independent proof verification, Lace wallet/DUST proving or Preview acceptance. Fixture timestamps were controlled local circuit inputs, not network time. The [first attempt and correction](../evidence/2026-11-06/browser-wasm/attempt-1/ERRATUM.md) preserve a startup timeout with zero proofs and correct its earlier CSP claim. The second run followed the worker boot-handshake and official ledger-initializer fixes. [NATIVE_NETWORK.md](NATIVE_NETWORK.md#browser-worker-circuit-proofs) explains the exact scope and remaining wallet test.

## Version 0.6.1 verification

Version 0.6.1 simplifies the application, README and diagrams around **Set up election**, **Choose a voter**, **Timed election**, **Reveal results** and **Verify election**, and adds receipt-file upload (JSON/text) alongside pasted receipt text. All affected local gates passed: seven native-browser scenarios, four network-browser cases, 46 boundary tests and static packaging (55 references, 388 files). The native browser cases cover receipt JSON/text uploads; rejection of invalid, private-field and oversized files; default five-voter setup at CPU slowdown ×12; real 15-second automatic closing; and genuinely frozen Chromium resuming after the deadline. Hosted compatibility [run 41699886738](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699886738) and Pages [run 41699843307](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699843307) passed at commit `fa94c3a19b4791441208ceae54a121faff2c588b`. Hosted compatibility passed all 40 native, 26 isolated-runtime, 46 boundary and three provider cases; eight real proofs across all seven circuits; and seven native-browser/four network-browser cases. Pages packaging passed with 55 references and 404 files, followed by successful deployment. The [0.6.1 devnet run](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41699843169) also passed: 17 indexer-confirmed accepted transactions, 16 completed proof transactions, five ballots and matching receipts, phase 3 totals `[2,1,2,0,0]`, final block 137. It ran from 19:07:32.051 through 19:21:09.753 UTC on 3 November 2026.

The external operator waited for actual indexed time `1793733576`, two seconds after the sealed closing deadline `1793733574`, then proved/submitted closing, trustees 1 + 3 and finalization. The [public report](../evidence/2026-11-03/v0.6.1/github/devnet/reports/network-evidence.json) records `automaticCloseAndTally: true` and `onChainSelfExecution: false`, all transaction identifiers and exact source hashes. The four invalid operations were rejected before proof/submission. Browser-wallet testing was not part of that Node run; independent chain inclusion remains unverified, and configured-indexer confirmation has that specific scope.

The compatibility runner used Node 24.22.1 / npm 11.19.1 / Python 3.12.15; Pages used Node 24.22.2 / npm 11.19.1 / Python 3.12.16. [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) records the artifact IDs, archive hashes and retained-file provenance. These actual CI browser runs are distinct from a direct test of the hosted origin; no new direct-origin browser result is claimed.

A real Chromium test reproduced a timed-election setup failure with five demo voters and CPU slowdown ×12: setup took 2,621 ms and remained “Not created.” The [failure report](../evidence/2026-11-03/v0.6.1/timed-setup-before-fix.json) records its actual bundle hash and environment. This additional case exposed a gap beyond the passing 0.6.0 browser suite. After the repair, a [separate full-flow diagnostic](../evidence/2026-11-03/v0.6.1/timed-setup-after-fix.json) passed with CPU slowdown ×12 for the entire five-voter, real 60-second election. Setup took 3,749 ms and reached “Getting ready”; one ballot was accepted and two trustees automatically finalized the result. The run recorded zero browser errors and zero remote requests. Contract deadline checks remain enforced.

The first network-browser attempt failed because its assertion expected the previous phrase “did not complete” after the interface changed to “could not finish.” The [failed report](../evidence/2026-11-03/v0.6.1/network-browser-wording-assertion-failure.json) is retained. Updating that wording assertion and rerunning produced four passing cases; the failed attempt is not relabeled as passing.

All three revised SVG diagrams were rendered and reviewed in actual Chromium 156.0.8078.4. Their text remained within the canvas, and visual review found no overlap or clipping. The [graphics report](../evidence/2026-11-03/v0.6.1/graphics-review.json) retains exact source/render hashes and the reviewed PNGs. No hosted-origin request was made.

## Version 0.6.0 verification

Version 0.6.0 added 2–5 active candidates in five fixed ciphertext lanes, a candidate-count-bound configuration, 1–1,024 synthetic browser credentials, a private credential selector, timed local preview and fresh-session public JSON/receipt verification. Compact 0.31.1 completed full compilation of all seven circuits. The combined native suite passed all 40 cases: 26 generated-contract cases and 14 public-verifier cases. The isolated wallet graph passed its 26 generated-runtime cases, and the root boundary suite passed 46 cases. The native example returned `[2,1,2,0,0]`. Proof-server 8.1.3 generated eight actual proofs across all seven circuit types. Fresh logs are retained under [`evidence/2026-11-03/v0.6.0/`](../evidence/2026-11-03/v0.6.0/). The latter include native point/subgroup rejection, all candidate counts, receipt/aggregate/tally tampering and an explicit demonstration that self-consistent substituted contributions do not establish authenticity or fairness.

Fresh 0.6.0 native browser verification passed all seven real Chromium cases after correcting the mobile layout: all three trustee pairs across 2, 3 and 5 choices; fresh-session public import and every receipt; tampered-record rejection; an actual 15-second automatic preview; an actual 18-second Chromium freeze/resume deadline case; and two missing-prerequisite controls. The network client passed its four real browser initialization/failure cases. Static packaging passed with 57 references and 310 files. Hosted compatibility [run 41695611384](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695611384) and Pages [run 41695345239](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695345239) passed at commit `3839a91eeb9079bcb05d74d86ede27d03eb53d45`, including the same native, proof and browser gates. The 0.6.0 [devnet run](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41695367454) failed at `cast-5`: 12 accepted transactions included four ballots, while the fifth ballot's submission remained unconfirmed. The closing/trustee/finalization operator was not reached. Its [public failure report](../evidence/2026-11-03/v0.6.0/github/devnet/reports/network-evidence.json) retains the pending transaction and actual source/version data. Twelve proof transactions completed; that does not turn the pending ballot into an accepted transaction. The eight-minute voting window now in the runner replaces the four-minute window; the four-minute enrollment period is unchanged. Insufficient voting time is a working diagnosis, not a recorded network rejection reason. The subsequent 0.6.1 run completed all 17 accepted transactions and the external scheduled tally, as recorded above. Completed runs retain their exact source provenance. Local browser scheduling and the isolated devnet operator are separate: the first holds synthetic shares in one tab; the second needs actual running services and two externally supplied synthetic shares.

Hosted compatibility used Node 24.22.1 / npm 11.19.1 / Python 3.12.15; Pages used Node 24.22.2 / npm 11.19.1 / Python 3.12.16. Compact 0.31.1, runtime 0.16.0, Midnight.js 4.1.1 and proof-server 8.1.3 remain the tested native versions. [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) records artifact IDs, archive hashes and retained-file manifests. The initial compatibility run failed at the installer due to a GitHub API rate limit; that failure and the subsequent same-commit successful run are retained separately.

All three updated SVG graphics were rendered locally in real Chromium and visually reviewed, with no text overflow or clipping. [graphics-review.json](../evidence/2026-11-03/v0.6.0/graphics-review.json) retains the source/render hashes and exact scope. No new direct browser test of the hosted origin is claimed.

The three installed-provider API cases also passed. Fresh npm audits report zero application-graph vulnerabilities and eight moderate isolated-devnet entries, with no high or critical entries. The exact snapshots are [application-audit.json](../evidence/2026-11-03/v0.6.0/application-audit.json) and [devnet-audit.json](../evidence/2026-11-03/v0.6.0/devnet-audit.json). The remaining entries are still in the separate testkit/container/archive dependency chain; an audit result is not a security certification.

## Version 0.5.0 verification

Version 0.5.0 passed fresh local verification. Compact 0.31.1 compiled all seven native circuits, producing 14 key files and 14 ZKIR files. All 45 native input/receipt/configuration tests, 20 actual generated-contract tests and three installed-provider API tests passed. The example accepted five ballots and finalized `[2,1,2]`. Both browser bundles built successfully.

The updated interface passed five real Chromium cases covering ballot-card clicks, keyboard operation, all three trustee pairs, exactly-two selection, reset, a 390-pixel mobile viewport and fail-closed prerequisites. The network client passed four initialization/failure-handling cases. These results are retained under [`evidence/2026-11-03/v0.5.0/`](../evidence/2026-11-03/v0.5.0/).

Hosted 0.5.0 compatibility [run 41689471487](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689471487) passed at commit `a904ea5c1688952fe3bfd459e51e9a1cf49db436`, including 45 boundary, 20 generated native, 20 isolated-graph and three provider API tests, eight actual proofs across seven circuits, and the five native/four network browser cases. Its environment was Node 24.22.2, npm 11.19.1 and Python 3.12.16. [Pages run 41689472206](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689472206) completed its build and deployment successfully; this revision's browser checks ran on the CI runner, without a new direct browser test of the deployed origin. The corresponding [devnet run 41689476184](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41689476184) also passed: 17 accepted transactions, 16 completed proof transactions, five matching receipts, four pre-submission negative checks and final tally `[2,1,2]` at block 98. It ran from 18:01:37.620 through 18:11:22.157 UTC; its own Node process reports 24.22.1. The [public network report](../evidence/2026-11-03/v0.5.0/github/devnet/reports/network-evidence.json) retains its exact contract, configuration and transaction identifiers. [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) records exact runs and artifact provenance. Completed proof and network outcomes remain tied to their recorded source hashes and commits.

Direct HTTPS browser evidence for the [GitHub Pages URL](https://ibkr-bouncybot.github.io/Midnight-BallotLab/) is tied to commit `b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`. The recorded 0.5.0 deployment is commit `a904ea5c1688952fe3bfd459e51e9a1cf49db436`, with successful runner-local browser checks as described above. [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) records each run's exact source and artifact provenance. The completed native evidence below is retained with its own version and execution scope.

## Provenance and environment

- Windows host: Node 24.18.0, npm 11.16.0, Python 3.14.6.
- Installed Ubuntu 24.04 through WSL 3.0.3.0; Linux kernel 6.18.54.1.
- Official devtools installer 0.5.1 verified against SHA-256 `85e74a53ae4a67b31fa4d854f3b6ffb4c29f7c53e3372c5008b6a4729a8b4a73`.
- Installed Compact 0.31.1, compact-runtime 0.16.0, onchain-runtime-v3 3.0.0 and Midnight.js 4.1.1. The SDK's locked ledger-v8 package is 8.1.0.
- Docker Engine 29.1.3 runs in WSL. Proof-server 8.1.3 image digest: `sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c`.

## Recorded native execution checks

| Check | Result |
| --- | --- |
| Native full compilation | Exit 0; seven circuits; 14 key files and 14 ZKIR files |
| Generated artifact/runtime compatibility check | Exit 0 |
| Actual generated native contract tests | 20 passed, 0 failed/skipped |
| Native example | Exit 0; five ballots; tally `[2,1,2]`; public snapshot only |
| Installed official provider API tests | 3 passed; fail-before-wallet-access behavior with actual SDK imports |
| Isolated devnet graph generated-runtime tests | 20 passed using byte-identical source/bindings with the separate wallet dependency graph; no transaction implied |
| Standalone circuit proof generation | Eight nonempty proof responses across all seven native circuit types; public hashes/byte counts/timings retained |
| Negative proof checks | Mismatched castBallot/enroll preimage and circuit material rejected by proof server; wrong registered trustee share rejected by generated circuit before requesting a proof |
| Native browser/WASM acceptance | Five Chromium cases passed: all three trustee pairs, decoded QR, receipt context checks, reset, public exports, root/subdirectory paths and missing-prerequisite controls |
| Network browser initialization | Four Chromium cases passed: real SDK/two WASM modules and 21 generated assets at root/subdirectory paths, no-wallet behavior, disabled manifest and missing WASM; no injected/mock wallet |
| Final static packaging check | Passed; relative assets, root/repository URL shapes and source ZIP integrity/exclusions checked |
| GitHub workflow validation | actionlint 1.7.12 passed all three workflows, including the isolated-runtime gate and manual full-devnet workflow; optional shellcheck/pyflakes integrations disabled. This is local validation, not a hosted run |
| Application dependency audit | Zero reported known vulnerabilities in the final application-graph audit snapshot |
| Isolated devnet dependency audit | Eight moderate package entries remain; zero high/critical after updating `ws` from 8.20.0 to 8.22.1 |
| Local proof-server health | 8.1.3, ready, proof format V2 |
| Complete isolated local-devnet election | 17 transactions confirmed `SucceedEntirely` by the configured local indexer; 16 completed proof transactions; five ballots and matching receipts; final phase 3, tally `[2,1,2]`, block 100 |
| Devnet negative cases | Invalid choice, duplicate credential, wrong trustee share and changed tally rejected before proof/submission; finalized transaction replay rejected by the submission pipeline, without independently verified network rejection |
| Clean isolated-devnet lockfile reinstall | `npm ci --ignore-scripts` passed after acceptance; all 20 generated-runtime tests passed again |

Native command evidence is retained under `evidence/2026-11-03` alongside public browser/proof reports. The native browser runs execute the generated contract locally and do not make proofs. The standalone proof run uses the official local proving provider and does not submit transactions. The network browser run verifies actual SDK loading and failure handling without a connected wallet. None is relabeled as network acceptance.

## Versions for the recorded 0.4.0 native evidence

| Component | Version |
| --- | --- |
| Recorded application source | 0.4.0; exact source hashes and commits retained in these execution reports |
| Compact devtools | 0.5.1 |
| Compact compiler / language | 0.31.1 / 0.23.0 |
| Compact runtime | 0.16.0 |
| On-chain runtime v3 | 3.0.0 |
| SDK protocol ledger-v8 | 8.1.0 |
| Midnight.js packages | 4.1.1 |
| DApp Connector API types | 4.0.1; no actual browser wallet accepted transaction yet |
| Local proof server | 8.1.3, proof format V2 |
| esbuild | 0.25.12 |
| Playwright / Chromium | 1.64.1 / 156.0.8078.4 |
| QR decoder / PNG decoder used by browser acceptance | jsQR 1.4.0 / pngjs 7.0.0 |
| Local Node / npm / Python | 24.18.0 / 11.16.0 / 3.14.6 |
| Executed GitHub runner | Ubuntu 24.04, Node 24.22.1, npm 11.19.1, Python 3.12.15; all three initial hosted workflows passed |

The isolated local-devnet wallet runner follows the current official examples in a separate graph: wallet SDK 1.2.0, testkit/Midnight.js 4.1.1, Compact runtime 0.16.0, ledger-v8 8.1.2, on-chain runtime-v3 3.1.1 and ZKIR-v2 2.1.1. Its 20 generated-runtime cases passed using byte-identical source/bindings. That graph is not substituted into the already tested application graph; network transaction outcomes remain separate.

## Development preset and proof-validation source inspection

The exact node tag's [development preset](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.400/res/cfg/dev.toml) selects a local `undeployed` genesis and mocks the Cardano/mainchain follower. The project's launcher and runner do not disable generated-contract validation or set a proof-bypass flag.

The tagged [node validation path](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.400/ledger/src/versions/common/mod.rs#L800-L848) uses the ledger's default strictness. The tagged [ledger defaults](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.3/ledger/src/verify.rs#L382-L410) enable native proofs, contract proofs, signatures, balancing and limits in real verification mode; the [contract verification implementation](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.3/ledger/src/structure.rs#L384-L444) invokes the verifier key. The [ledger manifest](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.3/ledger/Cargo.toml) includes proof verification by default, and the tagged [node ledger dependency](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.400/ledger/Cargo.toml) retains ledger default features.

This is source inspection of the named upstream releases, alongside verified official image digests. It is not independent attestation of the image build or an experiment submitting a deliberately invalid cryptographic proof to the network. The standalone prover's mismatched-input rejection and the runner's pre-submission negative checks have their own narrower recorded scopes.

## Demonstrated failures and repairs

- Windows had no supported compiler environment. Installed WSL/Ubuntu. Windows `compact.exe` is unrelated and is excluded by the explicit WSL launcher.
- The first compiler extraction lacked `unzip`; installed it and used a fresh task-specific compiler cache after the incomplete download.
- The real compiler rejected a potential disclosure of tally parameters in a ledger-dependent short-circuit check. `finalize` now declares its already-public totals before those checks. Bounds, sum checks and all pair equations remain enforced.
- Actual network-browser execution exposed an unbound `process` reference from an SDK browser dependency. The bundle now uses the installed `process/browser` and `Buffer` implementations; cryptographic operations remain in the actual Midnight runtime/WASM.
- Chromium rejected IPv6 literal CSP host sources. The unsupported sources were removed and insecure IPv6 indexer configuration now fails validation. Root/subdirectory network-browser loading then passed with zero page/console errors and no remote requests.

## Evidence and privacy

Raw compiler/test/build evidence is retained under `evidence/2026-11-03`. Public native examples and browser acceptance artifacts are under `artifacts`. Key reports are `artifacts/native-proof-evidence.json`, `artifacts/native-browser/result.json` and `artifacts/network-browser/evidence.json`. They record the actual generated-binding/bundle/asset hashes where relevant. Witnesses, private contexts, unproven transactions and proof preimages are never written to evidence. Proof-server verbose request logging is disabled.

The latest lockfile reviews are `evidence/2026-11-03/application-lockfile-review.json` and `devnet-lockfile-review.json`. They cover 162 application package entries and 383 isolated-devnet package entries respectively, with integrity metadata present and npm-registry source URLs throughout. Final dependency trees and audits are retained separately for both graphs.

The review records package integrity fields, registry locations, lifecycle-script declarations and runtime versions. Installs used `--ignore-scripts`. The application audit reports zero vulnerabilities. The separate devnet graph initially included a high-severity `ws` advisory; updating its direct dependency to 8.22.1 removed the high-severity finding. Eight moderate package entries remain through testkit's testcontainers/archive/glob/minimatch dependency chain. The acceptance runner does not invoke the testcontainers/container-archive path, but those dependencies remain installed; this is a scope distinction, not proof that the advisories are harmless. No forced, untested dependency downgrade was applied. These reviews and audit snapshots do not certify dependency or election security.

## Selected deployment targets and pending stages

The user selected [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab) and a fresh isolated local devnet. Authentication, source publication and Pages setup completed. The initial Pages, compatibility and devnet workflows all passed at commit `b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`. The [live application](https://ibkr-bouncybot.github.io/Midnight-BallotLab/) passed three deployed-browser cases, including 30 HTTP asset checks and the five-ballot native WASM flow. See [the hosted execution report](GITHUB_EXECUTION.md) for exact evidence.

The fresh isolated local-devnet election completed successfully on 3 November 2026 at 17:14:25.928 UTC. The configured local indexer confirmed all 17 transactions as `SucceedEntirely`, from deployment at block 8 through finalization at block 100. Sixteen contract proof transactions completed; five encrypted ballots produced five matching receipts, and trustees 1 and 3 finalized `[2,1,2]` in phase 3. The four invalid operations were rejected before a proof or submission. Replaying the finalized transaction was rejected by the submission pipeline; independent network rejection of that replay was not verified.

The chain was the official local `undeployed` development environment. The public [transaction report](../evidence/2026-11-03/public/devnet-network-evidence.json) contains all 17 transaction IDs, block heights, source hashes, exact runtime versions and the confirmation source `configured-local-indexer`:

- Contract address: `56a26175be9ab2149981d797c4075be2b868bc1c3ceb24001c642d45b40485cf`.
- Configuration digest: `c0209483e01ff1752403739693570136cd6e7bd291d94d7d2257c054a46e6b64`.
- Finalization transaction: `00bac1e2a610d2f5e409caba2ba55b3fac5f49aa3c0120b945fabd41bf401f328f`, block `100`.
- Isolated graph lockfile SHA-256: `94236d8b50f3545f214bfbb878e4d831500a0dd65eb5c147211a446e24ef9ecd`.

This is actual local node/indexer/wallet/prover acceptance, separate from the eight standalone circuit proofs and the browser's local execution. It does not establish independently authenticated chain inclusion, a browser-wallet transaction or public Preview/Preprod deployment. The node, indexer and prover were stopped after verification, preserving their local data; they are not persistent hosted services. The separate [GitHub devnet run](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684480267) also passed with 17 accepted transactions and 16 proof transactions on its own fresh chain, finalizing at block 99. Its different contract address and full public transaction list are retained in [the hosted report](../evidence/2026-11-03/github/devnet/reports/network-evidence.json).

The main browser experience remains local generated-contract execution with actual native Midnight WASM. It does not generate network proofs or submit ballots. The separate network page passed SDK-loading/failure-handling tests and the local Lace browser-wallet election described above. The Node devnet runner remains a separate acceptance path.

Independent authentication of initial state, maintenance history and canonical chain inclusion remains outside the current public-check implementation. The demo dealer knows all decryption secrets; the browser demo co-locates every synthetic role; two trustees can decrypt individual ballots outside the aggregate-only contract interface. The application does not claim election certification, coercion resistance, cast-as-intended assurance or fraud impossibility. Mainnet and real funds remain unauthorized.
