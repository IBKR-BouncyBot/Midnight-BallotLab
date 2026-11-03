# Midnight contract source

Version 0.4.0 continues two separate contracts. **`native-election.compact` is the encrypted-election implementation**, with native Jubjub ballot operations, aggregation, threshold decryption and final tally constraints. Start with [the native guide](../docs/NATIVE_MIDNIGHT.md) and [native client README](native/README.md). Its build and test commands are `npm run compile:native`, `npm run test:native` and `npm run demo:native` from this directory. Fresh compilation, all 20 generated-runtime tests, the native example, native browser/WASM flow and eight local proofs across all seven circuit types passed. Separate local-devnet acceptance completed 17 indexer-confirmed transactions and finalized five ballots as `[2,1,2]`; browser-wallet validation remains pending.

The rest of this page describes **`election.compact`, the older admission-only starter**, retained to make its narrower boundary explicit.

**Admission-starter status:** full compilation and all 11 generated-runtime tests passed during this continuation. It is retained for its narrower boundary, has no tally and is not the main browser contract. No admission-starter network deployment is claimed. See [the compatibility review](../docs/MIDNIGHT_COMPATIBILITY.md) and [fresh execution evidence](../docs/CONTINUATION_RESULTS.md).

`election.compact` implements the admission portion of an election protocol. It records an eligible member's commitment once. It does **not** validate an encrypted ballot, aggregate ciphertexts, verify decryption, or publish a result. It deliberately has no finalization endpoint; an administrator cannot pass in an unchecked total.

## Source interface

| Entry point | Input | Intended constraint / output |
| --- | --- | --- |
| Constructor | 32-byte election ID, manifest digest, administrator identity; opening/closing Unix seconds | Fixes configuration in sealed fields; requires a nonempty ID/digest/administrator and `opening < closing`. |
| `enroll` | 32-byte member identity | Administrator-secret authentication; enrollment before opening only; rejects duplicates; maximum 1,024 identities. |
| `openVoting` | None | Anyone may open during the fixed voting window after at least one enrollment. |
| `acceptCommitment` | Opaque 32-byte public record digest | Private Merkle path must be bound to the voter secret and current frozen electorate root; election-specific nullifier must be unused; records digest and nullifier at an explicit sequence number; returns and stores receipt digest. |
| `closeVoting` | None | Anyone may close at/after the fixed deadline. Closing does not certify any tally. |
| Pure helpers | See source | Derive administrator identity, election-specific member identity, nullifier, receipt. These use Compact typed hashing. |

Private witness names are `administratorSecret`, `voterSecret`, and `eligibilityPath`. Generate secrets with a cryptographically secure random generator; the small constants in the test file are test fixtures only. A wallet key is not used as evidence that somebody belongs to the electorate.

The member Merkle tree checks only its current root. Old paths from an earlier, smaller electorate fail. Once voting opens, enrollment has stopped and the root remains fixed. This limits root-based anonymity-set reduction, but does not hide timing, network metadata, the public member-commitment list, or a tiny electorate. Enrollment authority correctness and one credential per eligible person remain external responsibilities.

The receipt contains no vote selection or encryption randomness. It is an inclusion lookup key for the commitment ledger. Inclusion alone does not prove that a device encrypted the intended vote or that the final tally is correct.

## Build on a machine with the official toolchain

The official support matrix was checked on 2026-11-03. This starter targets **Compact toolchain 0.31.1 / language 0.23.0 / compact-runtime 0.16.0 / ledger 8**, not the newer ledger-9 compiler. `toolchain.json` records the reviewed version set and supplies the explicit compiler selector to the build script. Runtime and onchain-runtime pins are in `package.json`.

Install official [Compact devtools](https://docs.midnight.network/compact), use Node.js 22.12 or later, then run from this directory:

```bash
compact update 0.31.1
npm ci --ignore-scripts
npm run compile
npm test
```

The exact compiler command is:

```bash
compact compile +0.31.1 election.compact managed/election
```

The script first checks the explicitly selected compiler version. It then removes its disposable generated directory before compiling, so stale output cannot be mistaken for a successful new build. It uses no skip-proof flags. Successful compilation must generate real bindings, keys, circuits and metadata under `managed/election/`; the build checks nonempty `contract/`, `keys/`, `zkir/` and `compiler/` output and imports the generated module against the installed runtime. `npm run check:artifacts` reruns that output check alone. Neither the output check nor emulator execution is a cryptographic proof-generation or ledger-submission test.

The generated and reviewed `contracts/package-lock.json` is included; use `npm ci --ignore-scripts` for locked installs. Generated code, keys and ZKIR are real compiler outputs under ignored `managed/`, and must be regenerated from source for a fresh build. The separate manual **Midnight contract compatibility** GitHub Actions workflow performs both contract builds and standalone native proving. Its hosted run is still pending. Static frontend publication and contract deployment remain separate.

The supplied Node test file uses the actual runtime emulator. Its 11 passing cases cover unauthorized/duplicate enrollment, time gates, frozen enrollment, duplicate submission, another member's path, a changed Merkle sibling, an old subset root, nullifier domains, receipt storage and absent finalization. One test admits an arbitrary nonzero digest to expose the missing encrypted-ballot verifier. This limitation remains deliberate; the main native election instead constrains the full ciphertext.

The main native election has separate successful local proof-generation evidence and an actual Node wallet run with 17 transactions confirmed by the local development indexer. Its real SDK client and browser provider assembly live in `native/sdk-client.mjs` and `native/browser-providers.mjs`. They use actual encrypted private storage, indexer, ZK assets, wallet proving, balancing and submission APIs. A compatible wallet, test fee resources, consistent services and authenticated chain-state checks remain necessary for network operation. The separate browser-wallet transaction path remains untested; see [the current report](../docs/CONTINUATION_RESULTS.md). The older admission starter has no browser-protocol bridge.

## Remaining protocol work

Read [ADAPTER_GAP.md](./ADAPTER_GAP.md) before attempting integration. Admission currently accepts arbitrary opaque digests, so this contract cannot conduct even a complete toy encrypted election by itself. Ballot-validity constraints, audited threshold key setup, verified aggregate tally, and complete public record availability must become part of the protocol first.

Sealed fields prevent changes through this source's circuits. They do not neutralize a deployment's contract-maintenance authority, which can change verifier keys. A production design needs independently verifiable code/version pinning and a clearly defined maintenance policy before enrollment. Election IDs must be independently generated and unique: this single-contract source cannot enforce global ID uniqueness across deployments. Reusing an ID and voter secret repeats the identity and nullifier domains. No national-election security claim, availability guarantee, throughput estimate, coercion resistance, or fraud-impossibility claim follows from this starter.

## Primary references

- [Network/compiler support matrix](https://docs.midnight.network/relnotes/support-matrix): public-network compatibility and version pins.
- [Security and best practices](https://docs.midnight.network/guides/security-best-practices): source patterns for secret-derived authorization, path binding, nullifiers, sealed deadlines, and emulator context.
- [Ledger data types](https://docs.midnight.network/compact/reference/ledger-adt): tree, set, and map semantics. This rolling reference may describe a newer compiler; the pinned compiler must resolve final compatibility.
- [Private contract guide](https://docs.midnight.network/guides/build-a-private-smart-contract): language 0.23 and toolchain 0.31.1.
- [Deployment guide](https://docs.midnight.network/guides/deploy-and-operate): real proving/provider/deployment requirements and maintenance authority.
- [Node service wallet guide](https://docs.midnight.network/guides/node-server-wallet): explicit compiler version selection and compatible runtime package overrides.
