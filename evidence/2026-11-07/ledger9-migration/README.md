# Ledger 9 native migration evidence

These are fresh local checks from 7 November 2026. The actual Compact 0.36 compiler generated all seven circuits; 63 generated-runtime tests and the native demo passed. One actual openVoting proof was produced by the official ZKIR 3.2.0 WASM package in Node. This is not browser, Lace, DUST, accepted-transaction, or independent-proof-verification evidence. The proof fixture's earlier configure/enroll transitions were unproved runtime setup. The runner disables fetch and loads only local public keys and parameters.

The official support matrix now requires the Ledger 9 graph for the reset Preview chain: https://docs.midnight.network/relnotes/support-matrix . The current source/package/lock and compiler output hashes are in migration-summary.json. No historical ledger8 result was rewritten.

## Compiler and scalar review

The first direct Field-to-JubjubScalar migration encountered the compiler panic “ZkStdLibArch must enable jubjub”, matching open upstream issue https://github.com/LFDT-Minokawa/compact/issues/616 . Isolated actual compiler checks showed native JubjubScalar witnesses compile, including explicit conversion back to Field for the original canonical bounds. The final source uses that supported native type and compiled successfully; the compiler was not patched or validation disabled.

The contract diff preserves administrator/key-setup/deadline checks; nonzero canonical subgroup bounds; all three nonidentity trustee commitments; sealed configuration and candidate-count binding; voter-secret-bound Merkle paths and frozen roots; unique nullifiers; five in-circuit one-hot ciphertext lanes and distinct nonzero masks; exact ciphertext/context receipt hashes; the complete aggregate; frozen registered trustee contributions; and all three two-trustee tally equations. Public helper Field arguments retain canonical checks before native-scalar casts. Final totals enter as native scalars and are checked-cast to Uint32 before the original capacity, inactive-lane, sum and threshold checks. Generated negative tests include q−1, q and 2^32 totals. There is no substituted cryptography or success flag.

Runtime0.21 makes circuit execution asynchronous. The harness awaits the genuine calls, commits only successful contexts, and rejects overlapping calls or private-input/clock changes during execution. The new real-runtime concurrency test is included in the 63-test result.

## Public parameters and initial adaptation failures

public-parameter-provenance.json binds the k8/k12 hashes to the published @midnightntwrk/wallet-sdk-prover-client2.0.0 dist/effect/KeyMaterial.js source, then records exact fetched size/hash matches at the fixed official SRS URLs. The registry tarball integrity was sha512-DH385a71CQzRxBf7jO8HsnhLuAJTJQ/rZTwvskzN+jKo8aW/npPAJ5gDF19pvCB9SZo5Y0PgKbn54EiNzttgkw==. The source says the public parameter commitments are shared across ledger releases. The contract IR is version3 and requires ZKIR3.2.0; wallet-internal IR/version compatibility is a separate boundary.

The two failed-preimage-adaptation reports are retained separately. They failed before proving because runtime0.21 moved proof data to context.callProofDataTrace. The final diagnostic requires exactly one trace for the expected contract/circuit before serializing it, and the actual proof passed. Attempt1's exact runner is retained; attempt2's report retains its executed source hash but its exact intermediate runner was not separately archived. No raw witness-bearing exceptions were retained.

The full retained compiler/test/demo logs and source snapshots were checked for local absolute paths and the machine account name before copying. Their contents were copied without changing outcomes. The final proof report contains public sizes, hashes and timings only.
