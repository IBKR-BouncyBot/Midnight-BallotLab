# Midnight toolchain compatibility

Actual Lace 2.5.0 / API 4.0.1 completed nine local `undeployed` application transactions (eight native calls), finalizing `[0,1,0,0,0]`. See [wallet compatibility](NATIVE_NETWORK.md#wallet-compatibility) and [retained evidence](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/tree/main/evidence/2026-11-03/lace-wallet). A separate [Node Wallet SDK run on public Preview](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/blob/main/evidence/2026-11-06/public-preview-sdk/election-acceptance.json) completed nine accepted application transactions and eight proved contract calls. Browser-wallet transactions on Preview, wallet connection or transactions from the hosted GitHub Pages origin, and Preprod transactions remain untested; mainnet is blocked. Each run relies on its configured indexer and does not independently verify consensus.

Updated 3 November 2026 from installed packages and execution evidence. Version 0.6.1 passed seven native-browser scenarios, four network-browser cases, 46 boundary cases and packaging (55 references, 388 files) after the timed-setup repair, receipt-file upload and copy changes. A separate five-voter, real 60-second diagnostic passed with CPU slowdown ×12 throughout, including automatic two-trustee finalization and no browser errors or remote requests. Hosted compatibility and Pages deployment passed for 0.6.1 at `fa94c3a19b4791441208ceae54a121faff2c588b`: 40 native, 26 isolated-runtime, 46 boundary, three provider, seven native-browser and four network-browser cases passed, together with eight proofs across all seven circuits. Pages packaging passed (55 references, 404 files). The 0.6.1 devnet run also passed: 17 accepted transactions, 16 proof transactions, five ballots, automatic external closing/tallying, and `[2,1,2,0,0]` at block 137. Version 0.6.0 retains the pinned toolchain and compiles its seven native circuits with 2–5 active choices in five fixed lanes. Fresh local runs passed the combined 40-case native suite, 26 isolated-runtime cases, 46 boundary cases, the five-lane example and eight real proofs across all seven circuits. All seven native-browser and four network-browser cases passed, including fresh imports, receipt checks, scheduling and Chromium freeze/resume. Hosted compatibility and Pages deployment passed at commit `3839a91eeb9079bcb05d74d86ede27d03eb53d45`; the 0.6.0 devnet run failed at `cast-5` after 12 accepted transactions/four ballots, with the fifth ballot unconfirmed and no final tally. Its network operator was not reached. The later 0.6.1 run succeeded; the failed 0.6.0 outcome remains separately retained. Completed native/browser/proof/network/Pages runs remain attached to their exact source revisions. Local Lace browser-wallet validation passed separately. Read [CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md) and [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) for separate local and hosted results.

The runner now allows eight minutes for voting instead of four, retaining four minutes before opening. The adjusted window passed actual 0.6.1 acceptance. The external operator waited for indexed time two seconds beyond the sealed deadline, then submitted closing, two registered shares and finalization; `onChainSelfExecution` remains false. The browser repair has fresh passing real-clock, slow-device and freeze/resume evidence; browser success does not imply network acceptance. [The retained 0.6.0 failure report](../evidence/2026-11-03/v0.6.0/github/devnet/reports/network-evidence.json) is not overwritten by later attempts.

## Browser-worker proving — 6 November 2026

Commit `72b5e0164b5a1427d8d2b1191f04b6d5dffb5e27` passed fresh Compact **0.31.1** compilation and the [actual CI browser-worker proof gate](../evidence/2026-11-06/browser-wasm/github-42271382645/README.md): eight proofs across seven circuits, plus two negative checks. The frontend uses compact-runtime **0.16.0**, Midnight.js **4.1.1**, ledger-v8 **8.1.0**, onchain-runtime-v3 **3.0.0** and official ZKIR **2.1.1**. The same run passed its runtime/browser checks and Pages deployment. The generated prover, verifier, IR and public parameter files are size/hash-bound to the worker manifest.

This establishes the tested standalone circuit-prover path in a real browser. It does not establish full Ledger transaction proving, Lace wallet/DUST proving, Preview browser-wallet acceptance or a direct hosted-origin test. Historical HTTP-prover and Node Wallet SDK results retain their separate version graphs and execution scopes.

## Pinned target

The official [support matrix](https://docs.midnight.network/relnotes/support-matrix), updated 2 November 2026, lists devtools 0.5.1, compiler 0.31.1, Compact runtime 0.16.0, on-chain runtime v3 3.0.0 and Midnight.js 4.1.1 for ledger-8 public networks. The compiler implements language 0.23. The reviewed pins are recorded in `contracts/toolchain.json` and `contracts/package.json`.

Do not substitute a latest compiler/runtime: the matrix identifies compiler 0.34/0.35 and runtime 0.19/0.20 as ledger-9 combinations incompatible with its listed public networks. The supplied pin set was retained and compiled successfully. Actual installed APIs and fresh command output take precedence over rolling documentation when diagnosing this version set.

## Components and status

| Component | Implemented / verification status |
|---|---|
| `contracts/native-election.compact` | Native 2–5-choice election with five lanes: full compilation, 26 generated-contract cases, actual standalone proving and 17-transaction network acceptance passed for 0.6.1. The failed 0.6.0 network attempt remains in its own report. |
| Native witness/input adapter | Real private-input callbacks and subgroup scalar sampling. Dependency-free boundary tests executed. |
| Native emulator harness | Executes actual generated bindings/runtime. The three-active-choice example uses five ballots and padded totals `[2,1,2,0,0]`; no replacement implementation. |
| Native browser mode | Main UI with configurable choices/voters, private credential selection, manual/scheduled local flow and independent public import. All seven 0.6.0 native-browser cases passed, including fresh imports, every receipt, real-clock automatic closing and Chromium freeze/resume; results are recorded by source revision. |
| Native browser bundler | Successfully packages actual generated code/runtime/WASM. Missing prerequisites remain build failures. |
| Native SDK client | Real Midnight.js 4.1.1 provider assembly and browser wallet/election UI implemented. Completed SDK/WASM browser and 17-transaction Node wallet acceptance runs are retained by source revision. All four 0.6.1 network-browser cases and the separate 17-transaction Node wallet acceptance passed. Automatic external closing/tallying used actual indexed time and trustees 1 + 3. The separate local Lace browser-wallet election passed; see the evidence above. |
| Standalone local proving | Proof-server 8.1.3 generated eight proofs across all seven circuit types; mismatched preimage/circuit material was rejected. No wallet or network transaction involved. |
| Independent public verifier | Fourteen real-native tests passed. Strict fresh-session import validates native points/subgroups, configuration/receipts, aggregates and threshold equations. No eligibility/share proof or chain authentication is inferred. |
| Native snapshot export | Explicit public allowlist; no private state/proof witness export. Snapshots mark proof generation and chain authentication false. Projection tests are not native execution. |
| GitHub Pages | The 0.6.1 Pages deployment and hosted compatibility passed at `fa94c3a19b4791441208ceae54a121faff2c588b`, including seven native-browser and four network-browser cases on the CI runners. Direct HTTPS browser evidence for the [deployed application](https://ibkr-bouncybot.github.io/Midnight-BallotLab/) remains tied to `b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`; no new direct-origin test is claimed. Native/runtime/browser gates and reviewed lockfile installation remain required. Hosting supplies no node/prover infrastructure. |

## Review findings addressed in source

- Deployment has no proving stage. Private dealer key generation was moved out of the constructor into an administrator-authorized, one-time `configureKeys` circuit. Public metadata and empty initial state can be independently inspected before that transaction.
- Compact's coordinate `Field` is not the Jubjub subgroup scalar field. The source avoids scalar-polynomial arithmetic and inverses modulo the wrong field. Final tally equations use small positive coefficients instead.
- `Field` ordering and a `Uint<252>` cast are not valid solutions for scalar bounds. The source uses little-endian byte-derived limbs and a supported `Uint<248>` low limb.
- Points in impure execution are derived from native generator operations and sums, rather than trusting externally constructed point coordinates. Exported pure coordinate helpers are explicitly not point validators. The public importer separately applies official WASM point decoding, canonical coordinate checks and a native subgroup-order equation before invoking those helpers.
- Ballots bind actual ciphertexts to an election/configuration/nullifier. Five private selection masks must be nonzero and distinct, selection must be below the sealed 2–5 candidate count, and inactive totals must remain zero.
- Trustee calls use the complete frozen on-ledger aggregate; they accept no caller-selected subset. Finalization checks two registered contributions and bounded totals summing to accepted ballots.
- The configuration digest binds metadata, administrator, deadlines, candidate count and actual key commitments. Native receipts bind that configuration and ciphertexts. SDK client joins require an expected configuration digest in addition to the SDK's verifier-key comparison.

The actual compiler rejected a possible disclosure of totals inside a ledger-dependent short-circuit expression. The fix discloses the already-public final totals before the comparisons; all total bounds, sum constraints and trustee pair equations remain enforced. Fresh native tests and local proofs then passed. These results are not an independent audit of constraint soundness. Authentication of initial state, verifier keys/code, real setup transaction, network and maintenance policy remains necessary. Matching verifier keys alone does not establish honest initialization.

## Execution boundary

Official devtools/compiler were installed in Ubuntu 24.04 under WSL, exact npm dependencies were installed from the reviewed lockfile, and the native stages above executed. Reports identify the tested source and versions; new changes require their own checks.

Compiler/runtime execution, standalone proof generation and network acceptance are reported separately. The configured local indexer confirmed 17 transactions in the user-selected fresh devnet, finalizing `[2,1,2]` at block 100. The latest 0.6.1 GitHub devnet run confirmed 17 transactions on its own chain, including the external scheduled operator, and finalized `[2,1,2,0,0]` at block 137. Neither Node run establishes independently authenticated chain inclusion or browser-wallet behavior; the local Lace election was tested separately. The compiler scripts enforce explicit versions, clean disposable old output, require actual generated assets and import the actual runtime. They create no placeholder circuits or keys. No mainnet or real funds are authorized.

Read [NATIVE_MIDNIGHT.md](NATIVE_MIDNIGHT.md) for commands, exact native semantics, central-dealer limits and the remaining implementation/testing work.

## Primary references

- [Official support matrix](https://docs.midnight.network/relnotes/support-matrix)
- [Compact standard library](https://docs.midnight.network/compact/standard-library/exports)
- [Compact language reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Generated JavaScript and runtime semantics](https://docs.midnight.network/guides/compact-javascript-runtime)
- [Browser deployment and proving stages](https://docs.midnight.network/guides/browser-dapp)
- [Security and best practices](https://docs.midnight.network/guides/security-best-practices)
