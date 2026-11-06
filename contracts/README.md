# Native Midnight election contract

See [current verification status](../docs/VERIFICATION_STATUS.md) for completed runtime, proof and network runs, the live Preview browser-wallet attempt and remaining limits.

`native-election.compact` implements an encrypted election with 2–5 active choices and Midnight's native Jubjub operations. It checks key setup, voter membership, nullifier uniqueness, five-lane ciphertexts, receipt binding, aggregation and two-of-three trustee finalization. The sealed candidate count is bound into the configuration; inactive totals must be zero.

The contract supports up to 1,024 accepted ballots. These are implementation bounds, not a throughput or production-readiness claim. See [native implementation](../docs/NATIVE_MIDNIGHT.md) for the equations and [security limits](../docs/THREAT_MODEL.md) for the trust assumptions.

## Build and test

Install Compact devtools 0.5.1 and compiler 0.31.1, then run from this directory:

```sh
npm ci --ignore-scripts
npm run compile:native
npm run test:native
npm run demo:native
```

The reviewed package lock pins Compact runtime 0.16.0 and Midnight.js 4.1.1. Full compilation produces real generated bindings, keys and ZKIR under `managed/native-election/`. Missing compiler output is a build failure. [Windows instructions](../docs/WINDOWS_NATIVE.md) explain the explicit WSL launcher.

The generated-contract suite covers all supported candidate counts, invalid private inputs and all trustee pairs. The independent public-verifier suite imports records without private state and exercises strict schema, native point validation, commitments, aggregates, receipts and threshold equations. The example executes five synthetic ballots and returns `[2,1,2,0,0]` for three active choices. These runtime tests do not generate proofs or submit transactions. Current counts and completed runs are in [the execution report](../docs/CONTINUATION_RESULTS.md).

## Proving and network execution

`native/prove-local.mjs` requests eight real proofs across the seven circuit types from loopback proof-server 8.1.3 and retains only public proof hashes, lengths and timings. Run it after compilation with the supported server available.

`native/sdk-client.mjs` and `native/browser-providers.mjs` use actual Midnight.js contract, wallet, prover, indexer and submission APIs. The isolated `devnet/` graph has its own reviewed lockfile and a complete wallet acceptance runner. Its recorded local and hosted runs each confirmed 17 transactions and finalized five ballots with two trustees. See [GitHub execution evidence](../docs/GITHUB_EXECUTION.md) for exact tested commits, transaction IDs and confirmation scope.

The browser demo executes native cryptography locally. The separate network page generates application proofs in its browser worker and uses a compatible wallet for wallet/DUST work. Pages serves the frontend and public assets; external indexer/node services remain separate. Read the linked verification status before interpreting a runtime, proof or network result.

The network interface presents Connect, Set up election, Vote, Reveal results and Verify election as separate screens. Switching screens preserves the session without running an SDK operation. The verifier accepts downloaded network observations without a wallet and reports supplied-record consistency only. See [the current network guide](../docs/NATIVE_NETWORK.md#run-the-flow).

## Privacy and trust

Keep private choices, randomness, voter secrets, trustee shares and proof preimages out of logs and public records. The configured prover receives private witnesses and must be trusted. The demo dealer knows the complete decryption key, and two colluding trustees can decrypt individual ciphertexts outside the aggregate-only interface.

Independent verification must authenticate initial state, code and verifier keys, key configuration, chain state and maintenance policy. An indexer response or internally consistent snapshot alone is insufficient. This application makes no election certification, coercion-resistance or fraud-impossibility claim.

The [public verifier](native/verify-public.mjs) establishes supplied-record consistency only. A self-consistent replacement can pass because exports contain no authenticated ballot or trustee-share proofs. Read [the voter verification guide](../docs/PUBLIC_VERIFICATION.md) before interpreting its result.
