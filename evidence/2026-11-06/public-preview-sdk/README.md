# Public Preview SDK election test

This directory records a fresh, isolated Node Wallet SDK test on public Preview on 6 November 2026. It uses the current application's native client and generated Compact contract. The acceptance report identifies the exact source and dependency hashes.

- **Funding:** test NIGHT received through the Preview faucet. The wallet observed 10,000 tNIGHT across two deposits before registration. No mainnet funds were used.
- **DUST registration:** one accepted registration transaction, recorded separately from the election.
- **Local runtime:** 26 generated-contract tests passed using the clean SDK graph.
- **Proving and submission:** nine election transactions reported `SucceedEntirely` by the configured Preview indexer; eight completed contract-proof-provider calls. These are not counts of every prover HTTP request or wallet fee proof.
- **Result:** one synthetic ballot, two active choices, finalized five-lane totals `[0, 1, 0, 0, 0]`; indexed receipt and native public-record consistency checks passed.
- **Separate public read:** a second process checked the contract before opening and after finalization through the same public indexer, without opening a wallet or submitting a transaction.

The opening and closing deadlines were real contract times. An external test runner submitted the opening, closing, trustee and finalization transactions. The chain did not execute them automatically.

`prover-readiness.json` describes an earlier health check only. `runtime-provenance.json` describes staging, before network execution. `election-acceptance.json` is the completed network result. A successful registration alone does not establish contract proof generation.

The first registration process was stopped before submission for a dependency-provenance review. All 216 compared package files matched a clean npm installation. Registration then completed successfully. The executed registration helper has an earlier hash than the later portable helper; original machine-specific runner sources remain retained locally. This directory publishes allowlisted observations, source hashes and audit results, not wallet backups or witness data.

This run does **not** exercise Lace approval screens, the browser frontend or the hosted GitHub Pages origin. Confirmation relies on the configured public indexer; it does not independently authenticate consensus or chain inclusion. The public record is not a portable proof package. The synthetic trustee setup does not demonstrate independent custody, election certification or fairness. See the [network guide](../../../docs/NATIVE_NETWORK.md#public-preview-sdk-acceptance) for exact versions, identifiers and remaining browser-test limits.
