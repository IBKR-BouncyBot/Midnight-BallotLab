# Technical handover — Midnight Ballot Lab 0.3.0

Prepared 3 November 2026 for continuation in Codex.

## User objective

Build the voting application with real Midnight code, including native cryptography in the browser, and host its source and frontend through GitHub. Earlier requirements include private ballots, QR receipts, checking the final public tally, multiple trustees, Midnight styling and eventual on-chain operation.

The next session should implement and verify the unfinished native path, not merely publish the existing legacy page. GitHub hosting and Midnight contract deployment are separate deliverables. Repository and network details remain unspecified.

## Exact baseline

- Application version: 0.3.0.
- Source commit recorded by the previous repository: `5882d228f11f8b2022ca3ee6ad29bd05eb88965d`.
- Original portable archive: 58 files; SHA-256 `6a3e8b944f9a10b6e5d3f7275a9142c8ec53531ea7b281a6569808d175485d43`.
- All 58 original files are preserved byte-for-byte. This copy adds AGENTS.md, this handover and HANDOVER_VERIFICATION.md.
- Git history and Sites-specific hosting configuration are deliberately absent. The baseline commit is provenance, not a commit that necessarily exists in the new GitHub repository.

## Implementation map

| Path | Role and actual status |
|---|---|
| `src/crypto.mjs`, `src/protocol.mjs`, `src/app.mjs` | Existing local MODP/ElGamal protocol and UI. Tested but not Midnight-native. |
| `scripts/verify_reference.py` | Separate Python verifier for that legacy protocol only. It does not verify the native snapshot format. |
| `contracts/election.compact` | Retained admission-only starter accepting opaque commitment digests. Not the target full election. |
| `contracts/native-election.compact` | Target native election: key setup, private choice encryption, membership/nullifiers, full ciphertext storage/aggregation, trustee contributions and finalization. Uncompiled. |
| `contracts/native/adapter.mjs` | CSPRNG inputs, subgroup scalar checks, demo dealer and private witness callbacks. |
| `contracts/native/harness.mjs` | Loads actual generated contract/runtime; emulator calls and native tally recovery. No replacement runtime. |
| `contracts/native/demo.mjs` | Five synthetic ballots, expected tally [2,1,2]. Requires native compilation. Not executed successfully. |
| `contracts/native/record.mjs` | Public allowlist projection. Explicitly unauthenticated emulator snapshot, not a proof verifier. |
| `contracts/native/sdk-client.mjs` | Provider-injected Midnight.js deployment/circuit client source. No provider bootstrap or live wallet UI. Unexecuted. |
| `contracts/native/test/native-election.test.mjs` | 20 generated-runtime cases, unexecuted. |
| `src/native.html`, `src/native-app.mjs` | Interactive native emulator source: setup, voting, QR, trustee tally, public export/local checks. No native browser run completed. |
| `src/native-loader.mjs` | Keeps controls disabled unless native manifest is enabled and actual app initialization succeeds. |
| `scripts/build-native-browser.mjs` | Optional esbuild bundler for actual generated code, runtime and WASM; not successfully run. |
| `.github/workflows/pages.yml` | Native build enabled by default; local tests, native compilation/tests, static build, native bundle, packaging check and Pages deployment. Not run on GitHub here. |
| `.github/workflows/native-compact.yml` | Manual admission/native compilation, emulator tests/demo and native browser artifact workflow. Not run here. |

## Native design currently in source

Fixed three choices, up to 1,024 accepted ballots and a two-of-three trustee threshold. The browser example creates five synthetic voter credentials.

Encryption is exponential ElGamal constructed with Compact's native Jubjub generator multiplication, point multiplication and addition. It is application-level encryption built from Midnight primitives, not a ready-made election encryption service. Candidate bits are constrained by one private selection; each uses separate canonical nonzero randomness, with equality of masks rejected.

The subgroup order is:
`6554484396890773809930967563523245729705921265872317281365359162392183254199`.

This is not the Compact coordinate Field modulus. The source uses byte-derived limbs for scalar bounds and point addition for trustee public commitments. For tally count t and aggregate B, partials D_i satisfy:

- Pair 1,2: B + D_2 = tG + 2D_1.
- Pair 1,3: 2B + D_3 = 2tG + 3D_1.
- Pair 2,3: B + 2D_3 = tG + 3D_2.

Do not replace these with interpolation in the coordinate Field. The exported coordinate helpers do not validate arbitrary external points; points in constrained execution are intended to originate from native subgroup operations. Native UI imports no arbitrary public-coordinate snapshot.

Deployment does not establish a proof of private constructor computations. Key generation was moved into one-time, administrator-authorized `configureKeys`, before enrollment. Receipt/configuration hashes bind actual keys and election metadata. Matching verifier keys alone does not establish honest initial state.

The dealer still knows the master decryption key and all shares. It is not distributed key generation. Two colluding trustees can decrypt individual ballots outside the contract even though the contract exposes only aggregate contribution calls. Eligibility administration, coercion resistance, trustworthy devices and cast-as-intended verification remain unsolved production requirements.

## Toolchain recorded in source

| Component | Recorded version |
|---|---|
| Compact devtools | 0.5.1 |
| Compact compiler / language | 0.31.1 / 0.23.0 |
| compact-runtime | 0.16.0 |
| onchain-runtime-v3 | 3.0.0 |
| Midnight.js contracts / protocol | 4.1.1 |
| esbuild | 0.25.12 |
| CI Node / Python | 24 / 3.12 |

These are source pins reviewed in the preceding work, not proof that installation or compilation succeeds. Recheck the official support matrix for the chosen network before changing them. There is no contracts/package-lock.json yet. Review a real generated lockfile and commit it; do not claim fully reproducible transitive dependencies beforehand.

## First execution sequence

Use a machine/environment permitted to download the official compiler and npm dependencies. Ubuntu 24.04 with Node 24 and Python 3.12 matches the supplied CI configuration. Follow the official Midnight installer; do not assume a compiler is already installed.

From the project root, after installing Compact devtools:

```sh
compact update 0.31.1
npm --prefix contracts install --ignore-scripts
npm --prefix contracts run compile:native
npm --prefix contracts run test:native
npm --prefix contracts run demo:native
npm test
npm run build
npm --prefix contracts run build:browser:native
python3 scripts/check_pages.py
```

Use `npm --prefix contracts ci --ignore-scripts` after a reviewed lockfile exists. Capture each exit code and real compiler/test output. Repair actual errors before advancing; do not mask failure. Also run the retained starter compile/tests if retaining its compatibility workflow.

The native demo writes only public output under `artifacts/`. No generated contract, proof keys or native snapshot are supplied as though they were executed results.

**Build-order trap:** `npm run build` deletes/recreates `dist/` and writes `native-build.json` with native mode disabled. Native browser bundling must run afterward. The bundler enables the manifest only after real output/assets pass its checks. Never edit the enabled flag by hand.

The bundler handles actual WASM imports/literal URLs, rejects Node-only/external dependencies and keeps output disabled on failure. The precise pinned runtime's browser export shape and WASM initialization order are unverified. Inspect the installed packages and fix actual bundling/browser errors; these are review points, not established defects.

## Browser and network acceptance work

1. Compile and execute the native contract. Run invalid-choice/scalar, duplicate-credential, membership, timing, wrong-share and changed-tally tests against actual generated code; preserve all supported trustee pairs.
2. Bundle and serve the native page in an actual browser. Check setup, all choices, each trustee pair, QR/JSON receipt round trips, public exports, metadata/configuration binding, reset/error paths and project-subdirectory hosting. Verify WASM loads from the expected origin and no legacy encryption module supplies native mode.
3. Keep native-mode failures visible and controls disabled. Make native execution the main UI only after real evidence establishes it works. Preserve the existing Midnight-inspired layout.
4. Complete actual Midnight.js providers, wallet connection, key/circuit asset loading, proof generation, submission, confirmation and recovery. Use current official APIs for the chosen development/test network. Keep private witnesses local to a trusted prover and out of logs.
5. Test real valid and invalid transactions and report their exact outcomes. A generated-JavaScript emulator does not generate ZK proofs. A transaction hash or indexer match alone is not independent public election verification.
6. Define and implement an authenticated public verification/export path for the real deployment. The current native snapshot is not a portable proof package, and the legacy Python verifier cannot validate it.
7. Update the UI/docs to reflect actual achieved stages. Do not claim successful network voting while only an emulator is operational.

## GitHub deployment

The portable repository already has Pages and native-check workflows. Native mode is attempted by default on relevant events. PRs build/test but do not deploy; successful main/master pushes and eligible manual runs can deploy. The explicit legacy-only opt-out must not be used to satisfy this native task.

A GitHub owner/repository has not been supplied. Use the selected repository in the next environment or ask for that exact target when needed. Commit the project contents at the repository root, including hidden workflow files. No ChatGPT Sites files or remote are required.

Configure GitHub Pages to use GitHub Actions. Verify the deployed native page in addition to checking workflow status. GitHub Pages supplies static hosting, not a Midnight node, prover, wallet or indexer. Actual contract deployment needs separately configured services.

The first upload can run CI and expose uncompiled-source failures. Work on a feature branch while fixing them; do not interpret a red first build as a previously verified release regression.

## Evidence and completion criteria

Read HANDOVER_VERIFICATION.md before quoting results. The previous release recorded 95 local tests in a full run plus three subsequent loader tests; no native tests/proofs/network transactions passed. Do not relabel that as fresh native validation.

A finished native browser/GitHub milestone needs real compilation, generated-runtime test/demo results, actual browser/WASM checks, reviewed dependencies and a successful Pages deployment. The network milestone additionally needs real provider/wallet integration, proof/transaction evidence and authenticated public verification. Record outstanding blockers explicitly rather than merging the stages into one success claim.

## References

- https://docs.midnight.network/relnotes/support-matrix
- https://docs.midnight.network/guides/compact-javascript-runtime
- https://docs.midnight.network/guides/browser-dapp
- https://docs.midnight.network/guides/deploy-and-operate
- https://docs.midnight.network/guides/security-best-practices
- https://docs.midnight.network/compact/standard-library/exports
- https://learn.chatgpt.com/docs/cloud
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

Rolling Midnight documentation can describe newer releases than the pinned source. Verify claims against the actual installed version.

