# Native Midnight implementation

Actual Lace 2.5.0 / API 4.0.1 completed nine local `undeployed` application transactions (eight native calls), finalizing `[0,1,0,0,0]`. See [wallet compatibility](../../docs/NATIVE_NETWORK.md#wallet-compatibility) and [retained evidence](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/tree/main/evidence/2026-11-03/lace-wallet). A separate [Node Wallet SDK run on public Preview](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/blob/main/evidence/2026-11-06/public-preview-sdk/election-acceptance.json) completed nine accepted application transactions and eight proved contract calls. Browser-wallet transactions on Preview, wallet connection or transactions from the hosted GitHub Pages origin, and Preprod transactions remain untested; mainnet is blocked. Each run relies on its configured indexer and does not independently verify consensus.

This directory uses the generated bindings for [`../native-election.compact`](../native-election.compact). The contract performs ballot encryption and threshold decryption with Midnight's native Jubjub operations, and derives identities, nullifiers and receipts with Compact's typed hashes. It has 2–5 active choices, five fixed ciphertext lanes, up to 1,024 voters and two-of-three trustees.

Version 0.6.1 includes candidate-count binding and independent public-record verification. It passed Compact 0.31.1 compilation, all 40 native cases (26 generated-contract and 14 public-verifier cases), 26 isolated-runtime cases, eight real standalone proofs, seven native-browser and four network-browser cases. Hosted compatibility, Pages deployment and the separate 17-transaction devnet acceptance also passed, including automatic external closing/tallying to `[2,1,2,0,0]`. Browser, proof and network outcomes must be read against their exact tested revisions in [CONTINUATION_RESULTS.md](../../docs/CONTINUATION_RESULTS.md). Missing native prerequisites fail explicitly. The separate local Lace browser-wallet election passed; see the evidence above.

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
| `browser-config.mjs` | Explicit test-network, endpoint, wallet and local-prover configuration checks. |
| `browser-providers.mjs` | Actual Midnight.js private-state/indexer/ZK/wallet/proving/submission provider assembly. |
| `prove-local.mjs` | Real standalone circuit proving against loopback proof-server 8.1.3; saves public proof digests/counts/timings only. |
| `verify-public.mjs` | Fresh-session public JSON import; native point/subgroup checks, manifest/configuration/receipt commitments, aggregates and threshold equations. Reports consistency, not authentication or fairness. |

The root tests cover input checks and public export boundaries separately from native execution. The `test:native` suite imports the actual generated contract/runtime and includes independent public-verifier cases; the earlier 40-case result above belongs to its recorded revision, while the suite grows with new features. `node native/prove-local.mjs` from the contracts directory additionally checks and proves generated circuit preimages against a loopback proof server. Its successful report remains distinct from an emulator snapshot or accepted transaction; no private context or preimage is exported.

## Connect real Midnight providers

`sdk-client.mjs` uses Midnight.js 4.1.1 `CompiledContract`, `deployContract`, `findDeployedContract` and `callTx` APIs. `browser-providers.mjs` assembles actual wallet, transaction, public-data, encrypted private-state, ZK-asset and proving providers after the user explicitly selects a compatible wallet and test network. Importing a module does not connect, transact or create placeholder providers. The network UI is `src/network.html`; its earlier four-case SDK/WASM loading and failure-handling Chromium run passed at the recorded revision. The separate Node wallet runner completed 17 indexer-confirmed transactions on the fresh local devnet. The separate local Lace browser-wallet election passed; see the evidence above.

```js
import { createNativeSdkClient } from './native/sdk-client.mjs';

const client = createNativeSdkClient(providers, {
  compiledAssetsPath: compiledNativeAssetDirectory,
  networkId: configuredProviderNetworkId,
});
```

All providers must target the same intended network. Browser assembly verifies wallet-reported network/account/prover consistency before sensitive operations and requires local proving. `networkId` binds receipt context; it does not independently authenticate endpoints or chain state. The build packages actual generated keys/circuits under the selected frontend asset origin. A GitHub Pages site alone supplies none of the wallet, indexer, prover or node services. See [NATIVE_NETWORK.md](../../docs/NATIVE_NETWORK.md) for configuration and remaining acceptance checks.

The network UI has five separate screens with Back/Next and direct stage navigation. Screen changes retain the existing form elements and private session; they do not call the SDK. Verification can be opened without connecting a wallet. `verifyNativeIndexedObservation` validates the distinct network-export schema using the shared native point, commitment, aggregate and threshold checks, and returns an allowlisted consistency summary rather than authenticated chain evidence. Its optional choice manifest must match the committed digest; absent labels remain unknown.

For a new election, call `deploy` with the public election ID, manifest digest, administrator identity and Unix-second deadlines (`bigint` values). Then call `configureKeys` with the administrator secret and the private setup scalars. Deployment does not prove constructor computations; key derivation is deliberately performed by the separate, proven `configureKeys` circuit before enrollment. Publish and independently approve the returned configuration digest, which commits to public metadata, administrator, deadlines and all trustee keys.

For an existing configured election, call `join(contractAddress, expectedConfigurationDigest)` using a digest obtained through a trusted election announcement. The client checks the compiled contract through the SDK and recomputes the configuration digest before operations. Administrator enrollment uses `enroll(memberIdentity, administratorSecret)`; other calls are `openVoting`, `castBallot`, `closeVoting`, `submitDecryption` and `finalize`. The native circuits enforce phase, deadlines, eligibility, nullifier uniqueness, key possession and tally equations.

`castBallot({ voterSecret, selection })` accepts a `Uint8Array(32)` secret and a `bigint` selection from `0n` through `candidateCount - 1n` (up to `4n`). It obtains a native Merkle path, creates fresh private randomness and uses generated native helpers to compute the expected ciphertext and receipt from the exact private inputs before submission. After confirmation, it checks the indexed receipt both against its stored ciphertext and against that locally expected receipt. A mismatch fails the operation. It returns a public receipt envelope containing the network, contract address, configuration digest, native receipt hash, index and transaction reference. The envelope can be encoded in a QR code without adding the choice, voter secret or encryption randomness. `checkReceipt(envelope)` recomputes the receipt using indexed native ledger data and checks its accepted-set membership. It reports an indexed-state match, explicitly **not independently verified chain inclusion or verification of the transaction reference**. A receipt also does not prove that the voting device encrypted the voter's intended choice. `recoverTally(first, second)` derives the small public totals from the frozen aggregate and two published trustee shares using generated native group operations; its result depends on the authenticity of the indexed state.

An indexer error after a confirmed transaction can prevent receipt retrieval even though the transaction succeeded. Inspect the transaction and indexed public ledger before retrying. Never treat an absent local response as proof that the ballot was not submitted.

## Private material and remaining work

`createDemoDealer()` is a centralized demonstration key dealer. It knows the master decryption secret and every trustee share; it defeats the organizational privacy benefit of independent trustees if retained or misused. Production key setup requires a reviewed distributed key-generation ceremony, independent custody and secure delivery of shares. The single-process demo intentionally contains every synthetic role and must never handle real ballots.

The SDK adapter scopes witness inputs to one operation and does not place vote choices, randomness or trustee secrets in the SDK's stored private state. It returns public transaction information only. The actual proving provider still receives private witnesses: use a trusted local prover and secure the client. JavaScript cannot promise secure memory erasure. Never log or publish private contexts, SDK private transaction data or emulator `proofData`.

Native primitives and constrained circuits are only part of election security. Eligibility administration, distributed key setup, trustworthy voting devices, coercion resistance, ballot secrecy against colluding trustees, availability, authenticated public records and independent audits remain outside this prototype's guarantees. A national election needs those additional designs and review.

Primary API references: [Compact JavaScript runtime](https://docs.midnight.network/guides/compact-javascript-runtime), [browser dApp integration](https://docs.midnight.network/guides/browser-dapp), [deployment](https://docs.midnight.network/guides/deploy-and-operate), [security guidance](https://docs.midnight.network/guides/security-best-practices), and [native standard library](https://docs.midnight.network/compact/standard-library/exports). Rolling documentation can describe newer releases; the pinned compiler and runtime remain the compatibility gate.
