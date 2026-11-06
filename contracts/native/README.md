# Native Midnight implementation

See [current verification status](../../docs/VERIFICATION_STATUS.md) for completed runs, the live Preview browser-wallet attempt, exact versions and remaining limits. Historical results below remain tied to their recorded revisions.

This directory uses the generated bindings for [`../native-election.compact`](../native-election.compact). The contract performs ballot encryption and threshold decryption with Midnight's native Jubjub operations, and derives identities, nullifiers and receipts with Compact's typed hashes. It has 2–5 active choices, five fixed ciphertext lanes, up to 1,024 voters and two-of-three trustees.

Version 0.6.1 includes candidate-count binding and independent public-record verification. It passed Compact 0.31.1 compilation, all 40 native cases (26 generated-contract and 14 public-verifier cases), 26 isolated-runtime cases, eight real standalone proofs, seven native-browser and four network-browser cases. Hosted compatibility, Pages deployment and the separate 17-transaction devnet acceptance also passed, including automatic external closing/tallying to `[2,1,2,0,0]`. Browser, proof and network outcomes must be read against their exact tested revisions in [CONTINUATION_RESULTS.md](../../docs/CONTINUATION_RESULTS.md). Missing native prerequisites fail explicitly. The separate local Lace browser-wallet election passed; see the linked verification status.

## Run with the actual toolchain

Use Node 22.12 or later, Compact compiler 0.31.1, and the exact dependencies in `contracts/package.json` (Compact runtime 0.16.0, Midnight.js 4.1.1). From the repository root:

```sh
cd contracts
npm ci --ignore-scripts
npm run compile:native
npm run check:artifacts:native
npm run test:native
npm run demo:native
```

The compiler wrapper checks the compiler version. Generated modules are expected at `contracts/managed/native-election/contract/index.js`; compiled circuit assets must accompany them for real proving.

`demo.mjs` executes the actual generated contract and runtime locally. It creates synthetic credentials, configures keys through an impure circuit, enrolls five voters, casts five ballots, freezes the aggregate, submits trustees 1 and 3, and checks the expected five-lane tally `[2,1,2,0,0]`. This is an emulator demonstration: it neither generates ZK proofs nor submits transactions. It writes only an allowlisted public snapshot and canonical manifest to `artifacts/native-emulator-public.json`. Pass a different output file with `npm run demo:native -- /path/to/output.json`.

The public snapshot is explicitly marked `native-emulator-public/v2`, with `proofGenerated: false`, `network: null` and `ledgerInclusionVerified: false`. Its receipt hashes are checked by generated native code before export. A copied snapshot alone cannot prove that ballots were eligible, that any proof was accepted, or that a ledger record is authentic.

## Files and boundaries

| File | Purpose |
| --- | --- |
| `adapter.mjs` | CSPRNG private inputs, canonical scalar checks and generated-contract witness callbacks. |
| `harness.mjs` | Actual-runtime emulator and small-tally recovery using only generated native group helpers. |
| `record.mjs` | Dependency-free public-field projection; no proof or chain verification. |
| `demo.mjs` | Complete synthetic local election after native compilation. |
| `sdk-client.mjs` | Provider-injected Midnight.js client source for deployment and circuit calls. |
| `browser-config.mjs` | Explicit test-network, endpoint and wallet checks; rejects reported proof-server URIs without treating an omitted URI as mode attestation. |
| `browser-providers.mjs` | Actual Midnight.js private-state/indexer/ZK/wallet/browser-proof/submission provider assembly. |
| `browser-wasm-proof.mjs` | Bounded dedicated-worker contract proof jobs, safe progress/errors and termination. |
| `wasm-prover-worker.mjs` | Official ZKIR WASM checks and proofs; witnesses stay in worker memory. |
| `wasm-prover-assets.mjs` | Build-pinned manifest and public key/IR/SRS integrity checks; fixed same-origin GETs only. |
| `prove-local.mjs` | Real standalone circuit proving against loopback proof-server 8.1.3; saves public proof digests/counts/timings only. |
| `verify-public.mjs` | Fresh-session public JSON import; native point/subgroup checks, manifest/configuration/receipt commitments, aggregates and threshold equations. Reports consistency, not authentication or fairness. |

The root tests cover input checks and public export boundaries separately from native execution. The `test:native` suite imports the actual generated contract/runtime and includes independent public-verifier cases; the earlier 40-case result above belongs to its recorded revision, while the suite grows with new features. `node native/prove-local.mjs` from the contracts directory additionally checks and proves generated circuit preimages against a loopback proof server. Its successful report remains distinct from an emulator snapshot or accepted transaction; no private context or preimage is exported.

## Connect real Midnight providers

`sdk-client.mjs` uses Midnight.js 4.1.1 `CompiledContract`, `deployContract`, `findDeployedContract` and `callTx` APIs. `browser-providers.mjs` assembles actual wallet, transaction, public-data, encrypted private-state, ZK-asset and proving providers after the user explicitly selects a compatible wallet and test network. Importing a module does not connect, transact or create placeholder providers. The network UI is `src/network.html`; its earlier four-case SDK/WASM loading and failure-handling Chromium run passed at the recorded revision. The separate Node wallet runner completed 17 indexer-confirmed transactions on the fresh local devnet. The separate local Lace browser-wallet election passed; see the linked verification status.

```js
import { createNativeSdkClient } from './native/sdk-client.mjs';

const client = createNativeSdkClient(providers, {
  compiledAssetsPath: compiledNativeAssetDirectory,
  networkId: configuredProviderNetworkId,
});
```

All providers must target the same intended network. Browser assembly rechecks wallet network/account configuration before sensitive operations. Contract proofs use official ZKIR WASM in the application’s dedicated worker; select Lace’s **Run in this app (WASM)** mode for wallet/DUST proofs. No Docker, Node.js or HTTP proof service is required for this browser flow. The app rejects reported proof-server URIs, but API 4 omits the URI for both on-device and delegated TEE modes, so absence is not attestation. `networkId` binds receipt context; it does not independently authenticate endpoints or chain state. The build packages generated keys/circuits, the worker, actual WASM and pinned public parameters under the frontend origin. Pages supplies static files, not a wallet, node, indexer or proving service. See [NATIVE_NETWORK.md](../../docs/NATIVE_NETWORK.md) for setup and limits. Read [current verification status](../../docs/VERIFICATION_STATUS.md) for separate application-proof, wallet-mode and Preview acceptance observations; the dated server-based runs above do not establish the newer browser-only path.

The network UI has five separate screens with Back/Next and direct stage navigation. Screen changes retain the existing form elements and private session; they do not call the SDK. Verification can be opened without connecting a wallet. `verifyNativeIndexedObservation` validates the distinct network-export schema using the shared native point, commitment, aggregate and threshold checks, and returns an allowlisted consistency summary rather than authenticated chain evidence. Its optional choice manifest must match the committed digest; absent labels remain unknown.

For a new election, call `deploy` with the public election ID, manifest digest, administrator identity and Unix-second deadlines (`bigint` values). Then call `configureKeys` with the administrator secret and the private setup scalars. Deployment does not prove constructor computations; key derivation is deliberately performed by the separate, proven `configureKeys` circuit before enrollment. Publish and independently approve the returned configuration digest, which commits to public metadata, administrator, deadlines and all trustee keys.

For an existing configured election, call `join(contractAddress, expectedConfigurationDigest)` using a digest obtained through a trusted election announcement. The client checks the compiled contract through the SDK and recomputes the configuration digest before operations. Administrator enrollment uses `enroll(memberIdentity, administratorSecret)`; other calls are `openVoting`, `castBallot`, `closeVoting`, `submitDecryption` and `finalize`. The native circuits enforce phase, deadlines, eligibility, nullifier uniqueness, key possession and tally equations.

`castBallot({ voterSecret, selection })` accepts a `Uint8Array(32)` secret and a `bigint` selection from `0n` through `candidateCount - 1n` (up to `4n`). It obtains a native Merkle path, creates fresh private randomness and uses generated native helpers to compute the expected ciphertext and receipt from the exact private inputs before submission. After confirmation, it checks the indexed receipt both against its stored ciphertext and against that locally expected receipt. A mismatch fails the operation. It returns a public receipt envelope containing the network, contract address, configuration digest, native receipt hash, index and transaction reference. The envelope can be encoded in a QR code without adding the choice, voter secret or encryption randomness. `checkReceipt(envelope)` recomputes the receipt using indexed native ledger data and checks its accepted-set membership. It reports an indexed-state match, explicitly **not independently verified chain inclusion or verification of the transaction reference**. A receipt also does not prove that the voting device encrypted the voter's intended choice. `recoverTally(first, second)` derives the small public totals from the frozen aggregate and two published trustee shares using generated native group operations; its result depends on the authenticity of the indexed state.

An indexer error after a confirmed transaction can prevent receipt retrieval even though the transaction succeeded. Inspect the transaction and indexed public ledger before retrying. Never treat an absent local response as proof that the ballot was not submitted.

## Private material and remaining work

`createDemoDealer()` is a centralized demonstration key dealer. It knows the master decryption secret and every trustee share; it defeats the organizational privacy benefit of independent trustees if retained or misused. Production key setup requires a reviewed distributed key-generation ceremony, independent custody and secure delivery of shares. The single-process demo intentionally contains every synthetic role and must never handle real ballots.

The SDK adapter scopes witness inputs to one operation and does not place vote choices, randomness or trustee secrets in the SDK's stored private state. It returns public transaction information only. The browser worker receives application witnesses; its proof path has no HTTP fallback. Lace separately holds wallet witnesses, and its selected proving mode cannot be attested through API 4. Secure the device and use the on-device setting. JavaScript cannot promise secure memory erasure. Never log or publish private contexts, SDK private transaction data or emulator `proofData`. The standalone CLI/devnet proof-server utilities remain separate developer tools.

Native primitives and constrained circuits are only part of election security. Eligibility administration, distributed key setup, trustworthy voting devices, coercion resistance, ballot secrecy against colluding trustees, availability, authenticated public records and independent audits remain outside this prototype's guarantees. A national election needs those additional designs and review.

Primary API references: [Compact JavaScript runtime](https://docs.midnight.network/guides/compact-javascript-runtime), [browser dApp integration](https://docs.midnight.network/guides/browser-dapp), [deployment](https://docs.midnight.network/guides/deploy-and-operate), [security guidance](https://docs.midnight.network/guides/security-best-practices), and [native standard library](https://docs.midnight.network/compact/standard-library/exports). Rolling documentation can describe newer releases; the pinned compiler and runtime remain the compatibility gate.
