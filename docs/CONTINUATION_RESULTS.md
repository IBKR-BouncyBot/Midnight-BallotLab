# Fresh continuation execution — 3 November 2026

This report concerns commands executed during this continuation. The original 0.3.0 handover results are historical and are not counted as fresh tests.

## Provenance and environment

- The provided continuation ZIP passed its verifier: 65 files matched their recorded checksums before edits.
- Recorded baseline: `5882d228f11f8b2022ca3ee6ad29bd05eb88965d`, version 0.3.0; no Git history was included.
- Windows host: Node 24.18.0, npm 11.16.0, Python 3.14.6.
- Installed Ubuntu 24.04 through WSL 3.0.3.0; Linux kernel 6.18.54.1.
- Official devtools installer 0.5.1 verified against SHA-256 `85e74a53ae4a67b31fa4d854f3b6ffb4c29f7c53e3372c5008b6a4729a8b4a73`.
- Installed Compact 0.31.1, compact-runtime 0.16.0, onchain-runtime-v3 3.0.0 and Midnight.js 4.1.1. The SDK's locked ledger-v8 package is 8.1.0.
- Docker Engine 29.1.3 runs in WSL. Proof-server 8.1.3 image digest: `sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c`.

## Fresh completed checks

| Check | Result |
| --- | --- |
| Native full compilation | Exit 0; seven circuits; 14 key files and 14 ZKIR files |
| Generated artifact/runtime compatibility check | Exit 0 |
| Actual generated native contract tests | 20 passed, 0 failed/skipped |
| Native example | Exit 0; five ballots; tally `[2,1,2]`; public snapshot only |
| Retained admission contract | Full compile exit 0; 11 generated tests passed |
| Final root regression suite | 117 passed, 0 failed/skipped; local protocol, interface, input and provider-boundary tests |
| Python legacy reference tests | 11 passed after selecting the installed Python interpreter |
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

The final reruns are recorded in `evidence/2026-11-03/*-final.log` and the current public browser/proof artifacts. The earlier 116-test root pass and intermediate failed runs are retained separately; the final root result is 117. The native browser runs execute the generated contract locally and do not make proofs. The standalone proof run uses the official local proving provider and does not submit transactions. The network browser run verifies actual SDK loading and failure handling without a connected wallet. None is relabeled as network acceptance.

## Exact tested application versions

| Component | Version |
| --- | --- |
| Application source | 0.4.0 continuation of recorded 0.3.0 baseline |
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
| Prepared GitHub runner | Ubuntu 24.04, Node 24, Python 3.12; hosted execution pending |

The isolated local-devnet wallet runner follows the current official examples in a separate graph: wallet SDK 1.2.0, testkit/Midnight.js 4.1.1, Compact runtime 0.16.0, ledger-v8 8.1.2, on-chain runtime-v3 3.1.1 and ZKIR-v2 2.1.1. Its 20 generated-runtime cases passed using byte-identical source/bindings. That graph is not substituted into the already tested application graph; network transaction outcomes remain separate.

## Development preset and proof-validation source inspection

The exact node tag's [development preset](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.400/res/cfg/dev.toml) selects a local `undeployed` genesis and mocks the Cardano/mainchain follower. The project's launcher and runner do not disable generated-contract validation or set a proof-bypass flag.

The tagged [node validation path](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.400/ledger/src/versions/common/mod.rs#L800-L848) uses the ledger's default strictness. The tagged [ledger defaults](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.3/ledger/src/verify.rs#L382-L410) enable native proofs, contract proofs, signatures, balancing and limits in real verification mode; the [contract verification implementation](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.3/ledger/src/structure.rs#L384-L444) invokes the verifier key. The [ledger manifest](https://github.com/midnightntwrk/midnight-ledger/blob/ledger-8.1.3/ledger/Cargo.toml) includes proof verification by default, and the tagged [node ledger dependency](https://github.com/midnightntwrk/midnight-node/blob/node-1.0.400/ledger/Cargo.toml) retains ledger default features.

This is source inspection of the named upstream releases, alongside verified official image digests. It is not independent attestation of the image build or an experiment submitting a deliberately invalid cryptographic proof to the network. The standalone prover's mismatched-input rejection and the runner's pre-submission negative checks have their own narrower recorded scopes.

## Demonstrated failures and repairs

- Windows had no supported compiler environment. Installed WSL/Ubuntu. Windows `compact.exe` is unrelated and is excluded by the explicit WSL launcher.
- The first compiler extraction lacked `unzip`; installed it and used a fresh task-specific compiler cache after the incomplete download.
- The real compiler rejected a potential disclosure of tally parameters in a ledger-dependent short-circuit check. `finalize` now declares its already-public totals before those checks. Bounds, sum checks and all pair equations remain enforced.
- The initial root suite passed 95 tests and failed 11 because `python3` could not be launched. The independent Python checks subsequently passed using `C:\Python314\python.exe`; Windows now defaults to `python` while respecting explicit interpreter overrides.
- Actual network-browser execution exposed an unbound `process` reference from an SDK browser dependency. The bundle now uses the installed `process/browser` and `Buffer` implementations; cryptographic operations remain in the actual Midnight runtime/WASM.
- Chromium rejected IPv6 literal CSP host sources. The unsupported sources were removed and insecure IPv6 indexer configuration now fails validation. Root/subdirectory network-browser loading then passed with zero page/console errors and no remote requests.

## Evidence and privacy

Raw compiler/test/build evidence is retained under `evidence/2026-11-03`. Public native examples and browser acceptance artifacts are under `artifacts`. Key reports are `artifacts/native-proof-evidence.json`, `artifacts/native-browser/result.json` and `artifacts/network-browser/evidence.json`. They record the actual generated-binding/bundle/asset hashes where relevant. Witnesses, private contexts, unproven transactions and proof preimages are never written to evidence. Proof-server verbose request logging is disabled.

The latest lockfile reviews are `evidence/2026-11-03/application-lockfile-review.json` and `devnet-lockfile-review.json`. They cover 162 application package entries and 383 isolated-devnet package entries respectively, with integrity metadata present and npm-registry source URLs throughout. The earlier `dependency-review.json` covered an intermediate 124-entry graph and is historical, not the final review. Final dependency trees and audits are retained separately for both graphs.

The review records package integrity fields, registry locations, lifecycle-script declarations and runtime versions. Installs used `--ignore-scripts`. The application audit reports zero vulnerabilities. The separate devnet graph initially included a high-severity `ws` advisory; updating its direct dependency to 8.22.1 removed the high-severity finding. Eight moderate package entries remain through testkit's testcontainers/archive/glob/minimatch dependency chain. The acceptance runner does not invoke the testcontainers/container-archive path, but those dependencies remain installed; this is a scope distinction, not proof that the advisories are harmless. No forced, untested dependency downgrade was applied. These reviews and audit snapshots do not certify dependency or election security.

## Selected deployment targets and pending stages

The user selected [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab) and a fresh isolated local devnet. The GitHub repository is reachable and empty; authenticated write/Actions/Pages access is still being established. No push, hosted workflow run or Pages deployment is claimed yet, and no deployment URL is asserted.

The fresh isolated local-devnet election completed successfully on 3 November 2026 at 17:14:25.928 UTC. The configured local indexer confirmed all 17 transactions as `SucceedEntirely`, from deployment at block 8 through finalization at block 100. Sixteen contract proof transactions completed; five encrypted ballots produced five matching receipts, and trustees 1 and 3 finalized `[2,1,2]` in phase 3. The four invalid operations were rejected before a proof or submission. Replaying the finalized transaction was rejected by the submission pipeline; independent network rejection of that replay was not verified.

The chain was the official local `undeployed` development environment. The public [transaction report](../evidence/2026-11-03/public/devnet-network-evidence.json) contains all 17 transaction IDs, block heights, source hashes, exact runtime versions and the confirmation source `configured-local-indexer`:

- Contract address: `56a26175be9ab2149981d797c4075be2b868bc1c3ceb24001c642d45b40485cf`.
- Configuration digest: `c0209483e01ff1752403739693570136cd6e7bd291d94d7d2257c054a46e6b64`.
- Finalization transaction: `00bac1e2a610d2f5e409caba2ba55b3fac5f49aa3c0120b945fabd41bf401f328f`, block `100`.
- Isolated graph lockfile SHA-256: `94236d8b50f3545f214bfbb878e4d831500a0dd65eb5c147211a446e24ef9ecd`.

This is actual local node/indexer/wallet/prover acceptance, separate from the eight standalone circuit proofs and the browser's local execution. It does not establish independently authenticated chain inclusion, a browser-wallet transaction or public Preview/Preprod deployment. The node, indexer and prover were stopped after verification, preserving their local data; they are not persistent hosted services. A separate manual GitHub workflow for the same real acceptance path is prepared and locally linted but has not run on GitHub.

The main browser experience remains local generated-contract execution with actual native Midnight WASM. It does not generate network proofs or submit ballots. The separate network page contains real wallet/provider integration and passed SDK-loading/failure-handling tests, but no transaction through an actual browser wallet has been validated. The Node devnet runner is a separate acceptance path and does not fill that browser-wallet evidence gap.

Independent authentication of initial state, maintenance history and canonical chain inclusion remains outside the current public-check implementation. The demo dealer knows all decryption secrets; the browser demo co-locates every synthetic role; two trustees can decrypt individual ballots outside the aggregate-only contract interface. The application does not claim election certification, coercion resistance, cast-as-intended assurance or fraud impossibility. Mainnet and real funds remain unauthorized.
