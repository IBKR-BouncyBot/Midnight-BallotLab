# Native Midnight implementation

See [current verification status](VERIFICATION_STATUS.md) for completed runs, the latest Preview browser-wallet result, exact versions and remaining limits. Historical results below remain tied to their recorded revisions.

The current native election in `contracts/native-election.compact` targets Compact 0.36.0 / language 0.28.0 / runtime 0.21.0 and ledger 9, with Midnight.js 5.0.0 and official zkir-v3 3.2.0 browser proving. The Preview reset requires a new compatible deployment; previous contracts and transactions belong to the earlier chain. Fresh generated-runtime checks passed, while the migrated browser/proof/network stages require their own completed results. See [current verification status](VERIFICATION_STATUS.md).

The historical 0.6.1 ledger-8 build compiled seven circuits with 2–5 active choices and five ciphertext lanes. Its 40-case native suite, 26 isolated-runtime cases and eight standalone proofs passed, followed by separately recorded browser/network runs. Those version-specific results remain in [the execution report](CONTINUATION_RESULTS.md); they do not establish the ledger-9 migration. The browser demo executes actual generated code and WASM locally without proving or submitting transactions.

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
compact update 0.36.0
npm ci --ignore-scripts
npm run compile:native
npm run test:native
npm run demo:native
```

The source includes a generated and reviewed `contracts/package-lock.json`. Use `npm ci --ignore-scripts`; retain the lockfile with the source and review any dependency change. On Windows, use the explicit WSL compiler launcher described in [WINDOWS_NATIVE.md](WINDOWS_NATIVE.md); the system `compact.exe` is unrelated to Midnight.

The demo loads the actual compiler-generated bindings and `@midnight-ntwrk/compact-runtime`. It has no replacement arithmetic runtime or mock contract. It runs a synthetic election with three active choices, combines trustees 1 and 3 and expects five-lane totals `[2,1,2,0,0]`. It exports public fields and the canonical manifest to `artifacts/native-emulator-public.json`. Missing native prerequisites make it fail.

**Running generated contract JavaScript is an emulator test. It does not generate a zero-knowledge proof or submit a transaction.** The exported snapshot explicitly marks `proofGenerated: false`, `ledgerInclusionVerified: false` and `network: null`. It is not an independently authenticated election record.

The current **Midnight contract compatibility** workflow compiles/tests the native contract, runs the example, exercises both browser entries and requires actual browser-worker proofs. It starts no HTTP prover. Earlier ledger-8 compatibility, Pages and devnet passes remain linked in [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md), including the exact source of the historical direct-origin browser check. They are not current migration acceptance evidence.

### Historical ledger-8 standalone local proving

The preserved `contracts/native/prove-local.mjs` smoke uses proof-server 8.1.3 with ledger-8 circuit/key files. It must not be run with the newly generated ledger-9 assets. Its dated runs checked and generated eight proofs across seven circuits, with mismatched-material and incorrect-share negatives; public hashes/lengths/timings were retained without preimages. The historical manual devnet workflow retains this coverage behind an explicit ledger-8 compatibility preflight. It is separate from current browser-WASM proving, wallet work and network acceptance.

## SDK integration source

### Native cryptography in the browser

`src/index.html` introduces the application and links to **Browser demo** (`native.html`) and **Public testnet** (`network.html`). `src/native.html` and `src/native-app.mjs` provide four screens: **Set up election**, **Vote / Cast a ballot**, **Reveal results** and **Verify election**. Configure 2–5 choice labels and 1–1,024 synthetic voters, select unused credentials privately, cast encrypted ballots and save QR receipts. Manual mode permits selecting any trustee pair. Scheduled local preview uses a 15–3,600-second real-clock window and automatically closes and reveals with two synthetic shares. All roles still share the browser session. The QR encoder formats receipt bytes; it supplies no encryption.

The testnet page uses five screens, adding **Connect** before **Set up election**, **Vote**, **Reveal results** and **Verify election**. Its blue navigation buttons and **Back / Next** controls show one screen while preserving the in-memory session and existing form elements. Navigation does not run a contract operation or refresh network data. **Verify election** stays reachable without a wallet, and the activity panel stays available. See [the network flow](NATIVE_NETWORK.md#run-the-flow) for saved election details, private key files and offline network-record uploads.

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

Serve `dist/` and open `index.html` to choose a mode, or open `native.html` directly for the browser demo. The native bundler includes the actual runtime, generated contract and WebAssembly assets; it never substitutes another curve implementation. Native assets stay on the same origin. WebAssembly compilation requires the native page's `wasm-unsafe-eval` CSP permission; JavaScript `unsafe-eval` is not enabled. The browser acceptance gate exercises landing-page navigation, all trustee pairs, actual WASM loading, decoded QR receipts, public exports/imports, scheduling, reset, root/subdirectory hosting and missing-prerequisite failure handling. Fresh results are recorded by revision in the execution report. Network-page browser checks are a separate stage in the current report.

`native-build.json` enables the page only after successful bundling. Without that bundle, or if application initialization fails, the loader leaves the native controls disabled. The ordinary static build resets this manifest to disabled and removes old output. The GitHub Pages workflow requires native compilation, generated-runtime tests, both browser bundles and real browser acceptance. All native build gates are required.

The independent public verifier imports strict JSON in a fresh session without private credentials. It validates coordinates through official native WASM and an explicit subgroup check before using generated pure helpers; recomputes manifest/configuration/receipt commitments and aggregates; checks uniqueness and all published trustee-pair equations; and compares a voter's receipt. It establishes supplied-record consistency. The export carries no authenticated ballot or trustee-share proofs, so a self-consistent replacement can pass. It does not establish eligibility, chain inclusion or fairness. See [PUBLIC_VERIFICATION.md](PUBLIC_VERIFICATION.md). No wallet/provider connection is needed for local verification. The local election dealer still knows the complete decryption key.

### After voting and looking up a receipt ID

The receipt panel offers **Save receipt**, **Copy receipt ID** and **What happens next?**. In manual mode, the guidance tells voters to wait for voting to close and for any two trustees to reveal the totals. In a timed browser demo, keep the tab open: it closes voting and uses trustees 1 and 3 after the deadline. When results are ready, download the public election record so other voters can check the same record in a new session. These instructions do not change the contract or trigger a network transaction.

Under **Verify election**, select this tab's election or first upload and check a shared record. **Look up receipt ID** accepts a 64-character hexadecimal receipt digest and searches only that selected record. A unique match is checked against the encrypted ballot. Imported records are reverified using the real native public verifier; changing the selected record or ID clears the earlier result. The lookup does not search a public network or require a voter key.

An ID match does not prove who cast the ballot, reveal the choice, authenticate the record, establish fairness or demonstrate proof generation or blockchain confirmation. Keep the full JSON or QR receipt too: it includes election and configuration details that an ID alone does not carry. An uploaded record must pass its public consistency checks before it can be selected.

**Any two cooperating trustees can decrypt individual ballots outside the app, even before the totals are revealed.** Restricting the app's display and contract tally operation to combined totals does not prevent that cooperation. The browser demo creates all three shares in one session; it does not provide independent trustees or unconditional ballot secrecy.

The [6 November voter-guidance evidence](../evidence/2026-11-06/voter-guidance/README.md) records fresh local receipt-ID and guidance checks: 65 unit tests, 44 native-suite tests, nine native/landing browser cases and eight unconnected network browser cases. These results add no proof-generation or accepted-network-transaction claim.

### Network client source

`contracts/native/sdk-client.mjs` uses actual Midnight.js 5.0.0 contract APIs and the generated bindings. Provider configuration carries the network explicitly; contract-state reads are era-tagged and decoded with the matching ledger-9 runtime. It supplies methods for deploying, configuring, joining, enrolling, opening, casting, closing, publishing trustee shares and finalizing. It accepts real providers; it does not construct mock wallets or silently submit anything on import.

`contracts/native/browser-providers.mjs` assembles real encrypted private-state, indexer, ZK-asset, browser contract-proving, wallet balancing and submission providers. `browser-wasm-proof.mjs` runs the official ZKIR prover in a dedicated worker with bounded jobs, fixed error messages and build-pinned public assets. There is no HTTP-prover fallback. `src/network.html` exposes the test-network connection and election operations. Select a compatible DApp Connector 4 wallet on the same test network and Lace’s **Run in this app (WASM)** mode for its separate wallet/DUST proof work. No Docker, Node.js or HTTP proof service is required by the browser flow. Installed SDK/API and browser-loading checks are distinct from a connected-wallet transaction. The user-selected fresh local devnet passed the separate Node wallet acceptance path with 17 confirmed transactions; the separate local Lace browser-wallet election passed. A separate Node Wallet SDK run also completed nine application transactions and eight proved contract calls on public Preview. The [current verification status](VERIFICATION_STATUS.md) separates the latest browser-wallet Preview result from other completed runs and untested origins/networks. Follow [NATIVE_NETWORK.md](NATIVE_NETWORK.md) and `contracts/native/README.md`.

The adapter scopes secret witnesses to one operation and avoids persisting them into its SDK private-state record. The application’s proof worker receives contract witnesses in memory; Lace handles its own wallet/DUST witnesses. API 4 exposes no attestation of Lace’s proving mode: a missing `proverServerUri` occurs for both on-device and delegated TEE modes. The app rejects a reported server URI and rechecks configuration, but cannot certify the omitted-URI mode. Check **Run in this app (WASM)** in Lace; see [the exact limit](NATIVE_NETWORK.md#wallet-mode-limitation). Application-worker proofs, wallet-mode observations and network acceptance have separate evidence and limits in [current verification status](VERIFICATION_STATUS.md). The preceding server-based SDK/Lace runs do not establish the newer browser-only wallet proving path.

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
