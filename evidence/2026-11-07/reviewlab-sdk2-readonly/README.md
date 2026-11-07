# Fresh read-only test-wallet balance — 7 November 2026

The authorized existing ReviewLab test wallet was derived through its existing protected reader, then synchronized from fresh in-memory state with official Wallet SDK 2.0.0 and ledger-v9 1.0.0. The pinned Preview genesis and protocol were checked before and after synchronization. The [public balance report](balance.json) recorded **zero available NIGHT and zero DUST at 09:29:31.042 UTC**. The [address report](address.json) is separate from the balance result.

No previous checkpoint was read or written. No ReviewLab source or wallet checkpoint changed; no private state was persisted or exported. No proving provider was created, and no proof, signature or transaction was produced. These are configured-service synchronization results, not independent consensus verification. Earlier sponsor balances cannot supply this new-chain test; fresh test funding is required.

[Provenance](provenance.json) records the exact read-only helper and isolated dependency-lock hashes. Only public results are retained here; no protected wallet file, seed, private profile or raw diagnostic output is included. [File digests](SHA256SUMS.json) bind these retained bytes.
