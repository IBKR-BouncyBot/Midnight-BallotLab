# Five public test-wallet addresses — 7 November 2026

At **09:58:04.685–09:58:05.136 UTC**, a bounded, read-only canonical-indexer replay checked the five explicitly synthetic project addresses listed in the [original public report](public-wallet-balances.json): the Ballot SDK wallet, confidential-payment owner/merchant/Lace wallets, and ReviewLab SDK wallet.

**None of the five checked addresses had public unspent NIGHT on the current pinned Preview chain.** Each address replay completed at cursor zero with no transactions. The reset genesis and ledger-v9 protocol `2001100` were checked, with the same indexed block 5340/hash before and after the query and a matching historical-height anchor. This is configured-service consistency, not independent consensus authentication.

The result does not cover every wallet, shielded holdings, DUST, signing access, pending wallet reservations or independently attested spendable balances. Historical balances do not supply current test funds. The separately retained [SDK2 ReviewLab read](../reviewlab-sdk2-readonly/README.md) has its own narrower wallet-sync scope.

No wallet was opened. No private files or checkpoints were read or written; no signature, proof, funding or transaction was requested. The [exact executed helper](observe-balances.mjs.txt) and [provenance](provenance.json) bind the public record source hashes and query hash; [file digests](SHA256SUMS.json) preserve the unchanged report and source snapshot. The snapshot is retained for review, not automatically executed from this evidence directory.
