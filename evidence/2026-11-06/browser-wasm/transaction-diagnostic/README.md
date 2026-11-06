# Local Ledger transaction proof diagnostics — 6 November 2026

Two visible-button runs in the desktop in-app browser completed actual Ledger `Transaction.prove` calls through Midnight.js **4.1.1**, ledger **8.1.0** and official ZKIR **2.1.1** worker callbacks. The browser loaded a separate loopback diagnostic site. No warning or error was observed in the captured browser console after completion.

| Synthetic transaction | Recorded interval (UTC) | `Transaction.prove` elapsed | Worker proof callback | Proof bytes |
| --- | --- | ---: | ---: | ---: |
| [openVoting](openVoting-report.json) | 19:00:08.273–19:00:08.875 | 371 ms | 358 ms | 2,933 |
| [configureKeys](configureKeys-report.json) | 19:01:53.513–19:03:09.352 | 75,716 ms | 75,658 ms | 4,853 |

Each call completed a real constraint-check callback followed by a real proof callback, with the Ledger-supplied binding override present for proving. The [screenshot](configureKeys.png) shows both completed public reports. These are observed timings for these fixtures and device, not performance guarantees or proof that the user's pending operation was fixed.

The fixture used fresh synthetic secrets in browser memory, genuine generated contract transitions and official SDK transaction construction. Its `openVoting` setup used local generated configure/enroll calls without proving those setup calls. It used synthetic local timing and empty wallet keys/Zswap state. Nothing was balanced by Lace, signed or submitted. **Lace wallet/DUST proving, network acceptance and independent verification of the returned proofs were not tested.** This diagnostic invokes a fresh official `createProofProvider` around the application's real worker callbacks; it does not exercise the application's outer `proveTx` error/concurrency wrapper.

## Separate terminal-error regression

The application wrapper now preserves a finite worker failure code when the Ledger WASM boundary replaces a rejected callback error with a new Error. This improves the safe diagnostic for timeout, asset-integrity failure and cancellation; it does not speed up proving or establish the cause or resolution of a stall.

The [two-test regression log](terminal-error-regression.log) records the real Ledger error-wrapping boundary and actual-worker startup tests. The [failure-test source](browser-prover-failure.test.mjs.txt) uses a fail-only worker double for three terminal outcomes, never returning a successful check or proof. This is separate from the successful browser proof runs above. The [provider snapshot](browser-wasm-proof.mjs.txt) preserves the source at retention time.

## Provenance and privacy

[Build metadata](build.json) binds the diagnostic bundle to SHA-256 `c6a1fe5bf3dd010289f75871ed806d48c283233432b7688baf91cee4f07d9ddf`, the worker to `3ceca3126accb579a0c4428a63e5e526a7999aa273c75f930bf1f76a62d6a6d4`, and its public-asset manifest to `68fc0ab6b050b471fee124eb44926abeb0e35eb4baa4b2ccc635ca7df9d051a9`. These hashes were checked against the frozen site's actual bytes after completion. [Provenance](provenance.json) records 36 public build/asset hashes and six exact source snapshots. The [construction report](construction-report.json) is the earlier construction-only check, not proof evidence.

The byte-preserved [fixture](fixture.mjs.txt), [browser entry](entry.mjs.txt), [builder](build.mjs.txt) and [construction checker](check-construction.mjs.txt) contain code only. Reports contain finite status fields, callback types, binding-presence booleans, durations and proof lengths. They contain no serialized transaction, proof preimage, binding value, secret, private wallet data or personal filesystem path. [SHA256SUMS.json](SHA256SUMS.json) binds every retained file in this directory except itself. The frozen diagnostic and the user's active site were not changed during retention.
