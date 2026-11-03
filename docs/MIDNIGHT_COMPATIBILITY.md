# Midnight compatibility review — 0.4.0 continuation

Updated 3 November 2026 from installed packages, real compiler output and fresh execution evidence. Native compilation, generated-contract tests, the native browser/WASM flow, standalone circuit proof generation and isolated local-devnet transaction acceptance have passed. Browser-wallet validation and GitHub deployment remain pending. The main page runs the actual generated native contract locally; the older JavaScript protocol remains explicitly labeled at `legacy.html`. Read [CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md) for current run results.

## Pinned target

The official [support matrix](https://docs.midnight.network/relnotes/support-matrix), updated 2 November 2026, lists devtools 0.5.1, compiler 0.31.1, Compact runtime 0.16.0, on-chain runtime v3 3.0.0 and Midnight.js 4.1.1 for ledger-8 public networks. The compiler implements language 0.23. The reviewed pins are recorded in `contracts/toolchain.json` and `contracts/package.json`.

Do not substitute a latest compiler/runtime: the matrix identifies compiler 0.34/0.35 and runtime 0.19/0.20 as ledger-9 combinations incompatible with its listed public networks. The supplied pin set was retained and compiled successfully. Actual installed APIs and fresh command output take precedence over rolling documentation when diagnosing this version set.

## Components and status

| Component | Implemented / verification status |
|---|---|
| Legacy browser protocol | Retained at `legacy.html`; local RFC 3526 encryption/proofs, not Midnight-native or submitted to a chain. |
| `contracts/election.compact` | Retained admission-only contract; compiled and all 11 generated-runtime tests passed. Accepts opaque digests, so it is not a full election. |
| `contracts/native-election.compact` | Native three-choice election: full compilation passed, all 20 generated-runtime tests passed, and all seven circuit types produced standalone local proofs. |
| Native witness/input adapter | Real private-input callbacks and subgroup scalar sampling. Dependency-free boundary tests executed. |
| Native emulator harness | Executes actual generated bindings/runtime. Five-ballot example passed with tally `[2,1,2]`; no replacement implementation. |
| Native browser mode | Main UI. Five real Chromium acceptance cases passed, including all trustee pairs, QR decoding, public checks and fail-closed missing-WASM behavior. |
| Native browser bundler | Successfully packages actual generated code/runtime/WASM. Missing prerequisites remain build failures. |
| Native SDK client | Real Midnight.js 4.1.1 provider assembly and browser wallet/election UI implemented. Four real SDK/WASM loading and failure-handling browser cases passed. Separate Node wallet acceptance confirmed 17 transactions on the fresh local devnet; an actual browser-wallet transaction remains untested. |
| Standalone local proving | Proof-server 8.1.3 generated eight proofs across all seven circuit types; mismatched preimage/circuit material was rejected. No wallet or network transaction involved. |
| Native snapshot export | Explicit public allowlist; no private state/proof witness export. Snapshots mark proof generation and chain authentication false. Projection tests are not native execution. |
| Independent local algebra tests | Check integer-scaled two-of-three equations and scalar bounds in an abstract cyclic-group model. They do not execute Compact or Jubjub. |
| GitHub Pages | Workflows require native/runtime/browser gates and reviewed lockfile installation; no legacy-only opt-out. User selected `IBKR-BouncyBot/Midnight-BallotLab`; access, hosted CI and deployment are pending. Hosting supplies no node/prover infrastructure. |

## Review findings addressed in source

- Deployment has no proving stage. Private dealer key generation was moved out of the constructor into an administrator-authorized, one-time `configureKeys` circuit. Public metadata and empty initial state can be independently inspected before that transaction.
- Compact's coordinate `Field` is not the Jubjub subgroup scalar field. The source avoids scalar-polynomial arithmetic and inverses modulo the wrong field. Final tally equations use small positive coefficients instead.
- `Field` ordering and a `Uint<252>` cast are not valid solutions for scalar bounds. The source uses little-endian byte-derived limbs and a supported `Uint<248>` low limb.
- Points in impure execution are derived from native generator operations and sums, rather than trusting externally constructed point coordinates. Exported pure coordinate helpers are explicitly not point validators.
- Ballots bind actual ciphertexts to an election/configuration/nullifier. Three private selection masks must be nonzero and distinct, and selection must be one of three choices.
- Trustee calls use the complete frozen on-ledger aggregate; they accept no caller-selected subset. Finalization checks two registered contributions and bounded totals summing to accepted ballots.
- The configuration digest binds metadata, administrator, deadlines and actual key commitments. Native receipts bind that configuration and ciphertexts. SDK client joins require an expected configuration digest in addition to the SDK's verifier-key comparison.

The continuation's actual compiler rejected a possible disclosure of totals inside a ledger-dependent short-circuit expression. The fix discloses the already-public final totals before the comparisons; all total bounds, sum constraints and trustee pair equations remain enforced. Fresh native tests and local proofs then passed. These results are not an independent audit of constraint soundness. Authentication of initial state, verifier keys/code, real setup transaction, network and maintenance policy remains necessary. Matching verifier keys alone does not establish honest initialization.

## Execution boundary

The historical 0.3.0 environment could not install the toolchain. This continuation installed official devtools/compiler in Ubuntu 24.04 under WSL, installed exact npm dependencies, generated and reviewed the lockfile, and executed the native stages described above. Historical failures remain in the handover and old verification report; they are not the current execution state.

Compiler/runtime execution, standalone proof generation and network acceptance are reported separately. The configured local indexer confirmed 17 transactions in the user-selected fresh devnet, including finalization at block 100 with tally `[2,1,2]`; this does not establish independently authenticated chain inclusion. No hosted GitHub result or browser-wallet acceptance is claimed yet. The compiler scripts enforce explicit versions, clean disposable old output, require actual generated assets and import the actual runtime. They create no placeholder circuits or keys. No mainnet or real funds are authorized.

Read [NATIVE_MIDNIGHT.md](NATIVE_MIDNIGHT.md) for commands, exact native semantics, central-dealer limits and the remaining implementation/testing work.

## Primary references

- [Official support matrix](https://docs.midnight.network/relnotes/support-matrix)
- [Compact standard library](https://docs.midnight.network/compact/standard-library/exports)
- [Compact language reference](https://docs.midnight.network/compact/reference/compact-reference)
- [Generated JavaScript and runtime semantics](https://docs.midnight.network/guides/compact-javascript-runtime)
- [Browser deployment and proving stages](https://docs.midnight.network/guides/browser-dapp)
- [Security and best practices](https://docs.midnight.network/guides/security-best-practices)
