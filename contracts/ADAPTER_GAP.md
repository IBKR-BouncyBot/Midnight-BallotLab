# Browser demo → Midnight: explicit integration gap

Version 0.3.0 adds `native-election.compact` and `native/` as a new, separate native protocol. Its source computes encrypted ballots and tally constraints with Compact Jubjub primitives; compilation, proving and network execution remain unverified. See [the native guide](../docs/NATIVE_MIDNIGHT.md). This document's admission-only statements refer specifically to the retained `election.compact` file. The new protocol does not make existing browser records natively compatible.

The working browser protocol and `election.compact` are separate implementations. No button submits a Midnight transaction. A browser proof is not automatically a Compact proof, and a digest stored by this contract does not establish that a browser ballot passed verification.

## Serialization and binding

The JavaScript `hash(domain, ...values)` in `src/crypto.mjs` computes SHA-256 over UTF-8 encoded canonical JSON of:

```text
["midnight-ballot-lab-v1", domain, ...values]
```

Its canonicalizer sorts object keys, preserves array order, and permits only supported canonical JSON values. The returned digest is 64 lowercase hex characters. Group elements/scalars use canonical 512-character lowercase hex encodings in the browser protocol.

The concrete browser domains in `src/protocol.mjs` are:

| Value | Browser computation |
| --- | --- |
| Manifest digest | `hash('election-manifest', manifest)` |
| Credential nullifier | `hash('credential-nullifier', manifestHash, credentialPublicKey)` |
| Ballot receipt / ballot ID | `hash('ballot-receipt', ballotWithoutIdIncludingSignature)` |
| Complete result-record digest | `hash('final-election-record', record)` |

The final-record digest commits to a whole election export; it is not the per-ballot argument to `acceptCommitment`. The browser nullifier is linked to its public credential key. The native nullifier hashes a private secret instead. A future adapter must choose a consistent protocol, rather than equate those existing values.

The native `persistentHash<Vector<...>>` calls use Compact's typed binary encoding and padded 32-byte domain separators. **They are not hashes of the browser's canonical JSON.** Never substitute one for the other or reinterpret a browser nullifier as a Compact nullifier. A production adapter needs fixed cross-language test vectors for every encoding and domain.

An integration must make all of the following bindings explicit and verify them:

1. Define the canonical manifest and election identifier; map the agreed identifier to exactly 32 bytes and store the browser manifest digest as exactly 32 decoded bytes, not a 64-byte UTF-8 hex string. Freeze both before enrollment. The complete published manifest must match those bytes and include cryptosystem/group/version, choices, trustees, tally rules, electorate policy, and deadlines.
2. Replace or explicitly prove the relationship between browser credentials and native secret-bound membership. The browser's pseudonymous signing identity is public in its protocol; native membership proves knowledge of a secret behind an enrolled commitment without revealing the chosen leaf. These are different privacy models.
3. For each accepted ballot, bind the full encrypted record, ballot-validity proof, election identifier, manifest digest, native nullifier, and protocol version in the native circuit. A native nullifier must be derived by the circuit from the same secret whose enrollment path is checked; a supplied nullifier or a client-returned boolean must never authorize admission.
4. Define a single ballot-record commitment scheme and verify its preimage/proof inside Compact. `acceptCommitment(record)` currently takes the digest as an opaque argument. There is no native check that the hashed record contains the current election, this nullifier, a valid signature, or any ciphertext at all.
5. Publish all accepted encrypted records and proofs with durable availability, cross-checking each ordered digest and nullifier against finalized contract state. An off-chain file by itself has no chain-completeness guarantee. A missing record must make verification fail, not silently reduce the tally.
6. Bind every inclusion receipt to network ID, deployed contract address, election ID, finalized ledger/block reference, and record digest. The current native helper hashes election ID/nullifier/record; an adapter must add the deployment context to its receipt envelope and verify it independently. Browser receipts currently refer to the local protocol only.

## Cryptographic compatibility

The browser uses the RFC 3526 group-14 prime-order subgroup for exponential ElGamal, ballot bit proofs, signatures, and aggregate decryption proofs. Native Compact elliptic-curve operations use different groups and encodings; a 2,048-bit finite-field group element cannot be cast to a Compact `Field` or `JubjubPoint`.

Choose and validate one full approach:

- Implement the existing finite-field arithmetic and proof verification in Compact with correct limb arithmetic, range/subgroup checks, canonical encodings, transcript hashing, and measured proving cost; or
- Redesign encryption and proofs for a native supported curve, regenerate all keys/records/receipts, and implement the native ballot circuit with a constrained choice, randomness, and ciphertext relation. Specify group and scalar validation, key proof of possession, and cross-language test vectors. The current browser cryptography cannot be carried over unchanged.

In either case, a valid-vote proof must bind authorization and the exact submitted ciphertext to the same election. The verifier must prove a permitted ballot (for this demo, exactly one 0/1 choice), rather than trusting the frontend to call `verifyBit`. If signatures remain in the protocol, they require native verification bound to that exact ballot context; client signature checks alone are insufficient. With secret-bound native anonymous membership, a separate public voter signature may be unnecessary and would weaken anonymity if introduced carelessly.

## Final tally and trust boundary

The contract currently stores neither aggregate ciphertexts nor trustees. It has no tally verifier and no finalized-result field. Phase 2 means only **closed awaiting an unimplemented tally protocol**.

A complete extension must freeze threshold trustee parameters, validate key generation and shares, aggregate exactly the accepted ballots, verify decryption proofs against that aggregate, and constrain totals to ballot count and contest rules. The public verifier must reject altered manifests, extra/missing/reordered records where ordering matters, duplicate credentials/nullifiers, modified ciphertexts/proofs, wrong-election proofs, invalid trustee shares, and manipulated totals. Its inputs must be anchored to finalized chain data, not a user-selected subset.

Keep proving on a voter-controlled device or trusted local prover. Zero-knowledge on-chain verification does not imply that a remote prover cannot see submitted witnesses. Protect credential issuance, client integrity, metadata, recovery, polling operations, and trustee independence as distinct concerns. The browser demo's local custody model is not a deployed threshold-election ceremony.

## Acceptance gate before claiming Midnight support

Compile the source with the pinned toolchain; run real emulator tests, proof generation, malicious-witness tests, and concurrent ledger-submission tests. Implement and test the missing native constraints and adapter, verify complete records from an independent indexer/node, confirm maintenance-policy enforcement, and measure resource costs on the target network. Only then may the application accurately describe a vote or tally as verified by Midnight.
