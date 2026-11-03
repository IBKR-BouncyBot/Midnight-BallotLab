# Native Midnight implementation

Actual Lace 2.5.0 / API 4.0.1 completed nine local `undeployed` application transactions (eight native calls), finalizing `[0,1,0,0,0]`. See [wallet compatibility](NATIVE_NETWORK.md#wallet-compatibility) and [retained evidence](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/tree/main/evidence/2026-11-03/lace-wallet). Hosted-origin, Preview and Preprod transactions remain untested; mainnet is blocked. Confirmation relies on the configured local indexer and does not independently verify consensus.

The native election in `contracts/native-election.compact` uses Compact 0.31.1 / language 0.23.0 / runtime 0.16.0 and ledger 8. Version 0.6.1 compiles all seven circuits with 2–5 active choices and five fixed ciphertext lanes. Its combined 40-case native suite passed, including 26 generated-contract and 14 public-verifier cases; 26 isolated-runtime cases and eight actual standalone proofs also passed. Proof, browser and network results are tied to the source revisions in [the execution report](CONTINUATION_RESULTS.md); a successful compile is not evidence for those later stages. The main browser page uses the actual generated contract and native WASM locally. The separate local Lace browser-wallet election passed.

## What is implemented in the source

| Operation | Native constraint |
|---|---|
| Public constructor | Sets election metadata, deadlines and empty initial state; no private key setup is placed here. |
| `configureKeys` | Administrator-authorized, one-time setup before enrollment. Private dealer secrets produce the election key and three Shamir public-share commitments through native Jubjub operations. A configuration digest binds the actual keys, metadata, administrator, deadlines and candidate count. |
| `enroll` / `openVoting` | Administrator enrollment, fixed time window, current-root membership tree frozen before voting. |
| `castBallot` | A private selection must be below the sealed candidate count (2–5). Five nonzero, distinct private random scalars produce the full encrypted one-hot ballot in the circuit. A secret-bound membership path and unused election nullifier are required. |
| Public ballot storage | Stores all ciphertext coordinates, nullifiers and receipts at ordered positions. Aggregates are updated from those exact ciphertexts. A caller cannot substitute an opaque digest for ballot validation. |
| `closeVoting` | Closes at the fixed deadline and freezes the complete accepted ballot set. |
| `submitDecryption` | Proves knowledge of the selected trustee's registered secret share and computes its partial decryption of the frozen aggregate. There is no arbitrary-ballot-subset argument. |
| `finalize` | Requires two distinct submitted trustees, bounded totals summing to the accepted count, and the correct native group equations. |

The native source supports 2–5 active candidates and at most 1,024 ballots. All five ciphertext lanes are present and finalized inactive totals must be zero. These bounds are research limits, not throughput or production-readiness claims.

## Encryption and threshold arithmetic

The source uses exponential ElGamal constructed from Compact's native Jubjub `ecMulGenerator`, `ecMul` and `ecAdd` operations. It does not call a ready-made Midnight voting/encryption service. Compact circuits are intended to prove the private choice, encryption randomness, credential and ciphertext relations.

For each candidate, with selection bit `m`, fresh scalar `r`, generator `G` and election public key `Y`, the circuit computes `A = rG` and `B = rY + mG`. Each candidate receives its own random scalar. Reusing one mask across choices would leak information through ciphertext differences; the helper samples independent masks and the circuit rejects equal masks. Neither a circuit nor a nonzero check can establish that an external device's randomness is unpredictable.

Secret shares are `s_i = x + i*a mod q`, where `q` is the Jubjub subgroup order. Compact's coordinate `Field` has a different modulus. The JavaScript dealer performs share arithmetic modulo `q`; the circuit derives public-share commitments by point addition. Scalars are checked using a byte-derived high limb and a `Uint<248>` low limb, avoiding unsupported `Field` ordering and oversized integer types.

For an aggregate ciphertext `(A, B)`, trustee contributions are `D_i = s_i*A`. Finalization checks equivalent equations using only small positive coefficients:

- Trustees 1 and 2: `B + D_2 = count*G + 2*D_1`.
- Trustees 1 and 3: `2*B + D_3 = 2*count*G + 3*D_1`.
- Trustees 2 and 3: `B + 2*D_3 = count*G + 3*D_2`.

All points entering the impure operations are intended to originate from native generator operations and their sums. The exported pure coordinate helpers are arithmetic utilities, not validators for arbitrary externally supplied points. Do not treat a snapshot containing coordinates as a verified native execution.

## Run with the real compiler and runtime

From a machine that can install the official pinned toolchain:

```sh
cd contracts
compact update 0.31.1
npm ci --ignore-scripts
npm run compile:native
npm run test:native
npm run demo:native
```

The source includes a generated and reviewed `contracts/package-lock.json`. Use `npm ci --ignore-scripts`; retain the lockfile with the source and review any dependency change. On Windows, use the explicit WSL compiler launcher described in [WINDOWS_NATIVE.md](WINDOWS_NATIVE.md); the system `compact.exe` is unrelated to Midnight.

The demo loads the actual compiler-generated bindings and `@midnight-ntwrk/compact-runtime`. It has no replacement arithmetic runtime or mock contract. It runs a synthetic election with three active choices, combines trustees 1 and 3 and expects five-lane totals `[2,1,2,0,0]`. It exports public fields and the canonical manifest to `artifacts/native-emulator-public.json`. Missing native prerequisites make it fail.

**Running generated contract JavaScript is an emulator test. It does not generate a zero-knowledge proof or submit a transaction.** The exported snapshot explicitly marks `proofGenerated: false`, `ledgerInclusionVerified: false` and `network: null`. It is not an independently authenticated election record.

The **Midnight contract compatibility** GitHub Actions workflow compiles/tests the native contract, runs the native example, generates real local circuit proofs against a pinned loopback server, exercises both browser entries and preserves public evidence. It passed alongside the Pages and devnet workflows in [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab). The [live application](https://ibkr-bouncybot.github.io/Midnight-BallotLab/) also passed deployed-browser checks; [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) records the first tested commit and exact run evidence.

### Standalone local proving

With the real generated circuit/key files and a loopback-bound proof server 8.1.3 running, execute `node contracts/native/prove-local.mjs` from the repository root. The script uses the official `httpClientProvingProvider` and `NodeZkConfigProvider`, checks each preimage, then generates eight proofs across the seven circuit types. It also checks rejection of mismatched preimage/circuit material and an incorrect trustee share. Only public proof digests, lengths and timings are saved to `artifacts/native-proof-evidence.json`; witnesses and serialized preimages stay in process memory and loopback requests. This has recorded successful runs, independently of the emulator/browser tests. It is not wallet balancing, transaction submission, network acceptance or independent proof verification.

## SDK integration source

### Native cryptography in the browser

`src/index.html`, `src/native.html` and `src/native-app.mjs` provide **Set up election**, **Vote / Cast a ballot**, **Reveal results** and **Verify election**. Configure 2–5 choice labels and 1–1,024 synthetic voters, select unused credentials privately, cast encrypted ballots and save QR receipts. Manual mode permits selecting any trustee pair. Scheduled local preview uses a 15–3,600-second real-clock window and automatically closes and reveals with two synthetic shares. All roles still share the browser session. The QR encoder formats receipt bytes; it supplies no encryption.

After native compilation and emulator tests pass, run these commands from the repository root:

```sh
npm run build
npm --prefix contracts run build:browser:native
node scripts/build-network-browser.mjs
python3 scripts/check_pages.py
node contracts/node_modules/playwright/cli.js install chromium
node scripts/test-native-browser.mjs
node scripts/test-network-browser.mjs
```

Serve `dist/` and open `index.html` or `native.html`. The native bundler includes the actual runtime, generated contract and WebAssembly assets; it never substitutes another curve implementation. Native assets stay on the same origin. WebAssembly compilation requires the native page's `wasm-unsafe-eval` CSP permission; JavaScript `unsafe-eval` is not enabled. The browser acceptance gate exercises all trustee pairs, actual WASM loading, decoded QR receipts, public exports/imports, scheduling, reset, root/subdirectory hosting and missing-prerequisite failure handling. Fresh results are recorded by revision in the execution report. Network-page browser checks are a separate stage in the current report.

`native-build.json` enables the page only after successful bundling. Without that bundle, or if application initialization fails, the loader leaves the native controls disabled. The ordinary static build resets this manifest to disabled and removes old output. The GitHub Pages workflow requires native compilation, generated-runtime tests, both browser bundles and real browser acceptance. All native build gates are required.

The independent public verifier imports strict JSON in a fresh session without private credentials. It validates coordinates through official native WASM and an explicit subgroup check before using generated pure helpers; recomputes manifest/configuration/receipt commitments and aggregates; checks uniqueness and all published trustee-pair equations; and compares a voter's receipt. It establishes supplied-record consistency. The export carries no authenticated ballot or trustee-share proofs, so a self-consistent replacement can pass. It does not establish eligibility, chain inclusion or fairness. See [PUBLIC_VERIFICATION.md](PUBLIC_VERIFICATION.md). No wallet/provider connection is needed for local verification. The local election dealer still knows the complete decryption key.

### Network client source

`contracts/native/sdk-client.mjs` uses actual Midnight.js 4.1.1 contract APIs and the generated bindings. It supplies methods for deploying, configuring, joining, enrolling, opening, casting, closing, publishing trustee shares and finalizing. It accepts real providers; it does not construct mock wallets or silently submit anything on import.

`contracts/native/browser-providers.mjs` now assembles real encrypted private-state, indexer, ZK-asset, wallet proving, balancing and submission providers. `src/network.html` exposes the test-network connection and election operations, and its build includes actual generated keys/circuits. It requires an explicit compatible DApp Connector 4 wallet, a consistent selected network and local proving configuration. Installed SDK/API and browser-loading checks are distinct from a connected-wallet transaction. The user-selected fresh local devnet passed the separate Node wallet acceptance path with 17 confirmed transactions; the separate local Lace browser-wallet election passed; hosted-origin wallet transactions remain untested. Follow [NATIVE_NETWORK.md](NATIVE_NETWORK.md) and `contracts/native/README.md`.

The adapter scopes secret witnesses to one operation and avoids persisting them into its SDK private-state record. That does not stop the configured prover from receiving the witnesses. Use a trusted local proving setup; avoid remote proving services with voter choices or trustee secrets unless their trust and privacy properties are explicitly addressed.

## Trust and deployment checks still required

Deployment itself does not prove constructor execution. The source therefore moves private key setup into a separate impure `configureKeys` call. Before trusting any deployed election, independently authenticate its expected initial state, verifier keys/code, actual key-setup transaction, configuration digest, finalized chain state and maintenance policy. A caller-supplied configuration hash, a matching SDK verifier key or a serialized ledger snapshot alone does not prove an honest initial state or election.

The demo still uses a **central dealer that knows the complete key**. Separate trustees and an independently reviewed distributed key-generation design remain necessary for meaningful organizational separation. Two colluding trustees can decrypt individual ciphertexts outside this contract even though `submitDecryption` accepts only the frozen aggregate. The native design does not supply cast-as-intended verification, receipt-freeness, coercion resistance, audited human eligibility or election certification.

## Verification scope

Official pinned packages run under Ubuntu 24.04 in WSL and in GitHub Actions. Completed compilation, runtime, browser, proof, devnet and Pages runs are retained by source revision in the execution report. Version 0.6.1 passed full compilation, 40 native cases, 26 isolated-runtime cases, eight standalone proofs, seven native-browser and four network-browser cases. Hosted compatibility, Pages deployment and the separate 17-transaction Node wallet acceptance all passed at `fa94c3a19b4791441208ceae54a121faff2c588b`. The external scheduled operator finalized `[2,1,2,0,0]` at block 137 after actual indexed time passed the closing deadline. Local Lace browser-wallet validation passed separately. Configured-indexer confirmations are not independently authenticated chain inclusion.

The root suite checks native input adapters, secret exclusion in public projection, receipts, loader behavior and configuration boundaries. Those tests are distinct from generated native tests and are not a cryptographic security audit. [CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md) records completed runs and their scope; changes require fresh verification.

Primary references:

- [Official support matrix](https://docs.midnight.network/relnotes/support-matrix)
- [Compact standard library](https://docs.midnight.network/compact/standard-library/exports), noting that the rolling reference can describe newer releases
- [Generated JavaScript and emulator semantics](https://docs.midnight.network/guides/compact-javascript-runtime)
- [Browser deployment, proving and SDK providers](https://docs.midnight.network/guides/browser-dapp)
- [Native source compatibility review](MIDNIGHT_COMPATIBILITY.md)
