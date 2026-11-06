# Browser WASM proof execution — 6 November 2026

The successful second attempt generated **eight real proofs across all seven native election circuits**, using the official `@midnight-ntwrk/zkir-v2` **2.1.1** WASM prover in a dedicated browser worker. It ran in the desktop in-app browser against a loopback static-file server from **18:19:23.735Z to 18:24:47.551Z**. The test clicked the visible run button; no success flag or replacement arithmetic was used.

The [original public report](attempt-2/browser-report.json) and [screenshot](attempt-2/browser-proof-success.png) retain the outcome. Key setup took 83,698 ms and ballot casting took 170,150 ms on this device. Timings include circuit execution, checks, asset loading and proving; they are not performance guarantees for other devices. Both wrong-share and mismatched-circuit rejection checks passed. No warning or error was returned by the browser's captured console after completion.

## What this establishes

- Actual generated Compact 0.31.1 circuits, compact-runtime 0.16.0, Midnight.js 4.1.1 and official ZKIR 2.1.1 executed in a browser. The frontend retains ledger-v8 8.1.0 and onchain-runtime-v3 3.0.0.
- Real proof bytes were returned for key setup, enrollment, opening, a five-choice ballot, closing, trustee contributions 1 and 3, and finalization. Only their sizes, hashes and timings were retained.
- Synthetic witnesses were created inside browser memory. The application worker has no HTTP proof provider or fallback and only downloads same-origin public files with pinned size/SHA-256 checks. The task-owned HTTP proof server was stopped before testing.
- The test used a synthetic local circuit clock. It neither advanced Preview time nor submitted a transaction.

This run **did not connect Lace, produce wallet/DUST proofs, submit a Preview transaction, or independently verify proof validity or chain inclusion**. The separate [public Preview SDK election](../public-preview-sdk/README.md) used an HTTP prover and remains separate evidence. Fresh Lace/Preview browser-only acceptance is pending.

## Failure and source provenance

[Attempt 1](attempt-1/browser-report.json) timed out during worker initialization without producing a proof. Its report is preserved unchanged; its [erratum](attempt-1/ERRATUM.md) corrects an overbroad CSP metadata label. The fix waits for the worker's actual WASM initialization and message listener before sending the asset initialization request. A real-worker startup regression also exposed and fixed a tree-shaken ledger initializer, then checked cleanup after an initialization failure.

[Build hashes](attempt-2/build.json), the [harness build record](attempt-2/proof-check-build.json), and byte-preserved `.mjs.txt` snapshots bind the successful run to the tested code. The generated contract files were reused byte-for-byte from the separately recorded compiler output; this local run is not a fresh compiler invocation. GitHub CI compiles the source again before running its own browser proof gate.

The final [dependency review](attempt-2/dependency-review.json) adds exact ZKIR 2.1.1, declares the existing ledger 8.1.0 dependency directly, and removes the unused wallet-delegated contract proof provider. No other resolved package version changed. Removal of that unused dependency followed the frozen browser build and did not alter the tested bundle.

[Fresh source checks](attempt-2/local-tests.json) passed 111 boundary and 13 installed-provider/worker/packaging tests. The earlier same-session [generated-contract test report](attempt-1/local-tests.json) records 62 passes, separately from the browser proofs. [CI source validation](attempt-2/ci-source-check.json) includes workflow linting; it is not a successful hosted CI run.

## Hosted CI and deployment

The later [CI run 42271382645](github-42271382645/README.md) passed at commit `72b5e0164b5a1427d8d2b1191f04b6d5dffb5e27`: fresh native compilation, runtime/browser checks, eight actual worker proofs across seven circuits and both negative checks. GitHub Pages deployment succeeded. Its proof report and audited deployment artifacts are retained separately from the local attempts above. No wallet, full transaction proving, network acceptance or direct hosted-origin test was added by this CI run.

## Local Ledger transaction proof diagnostics

The later [two-call diagnostic](transaction-diagnostic/README.md) completed actual Ledger `Transaction.prove` calls for synthetic `openVoting` and `configureKeys` transactions through official SDK construction and real worker check/prove callbacks. They completed at **19:00:08 UTC** and **19:03:09 UTC**, taking **371 ms** and **75,716 ms** inside the transaction-proof call. Exact public reports, a screenshot, source snapshots and frozen build hashes are retained separately. No Lace/DUST work, signing, submission or independent proof verification was attempted.

A separate failure-only regression preserves the worker's finite terminal error when Ledger wraps a rejected callback. It improves diagnostics; it neither improves proof performance nor establishes that the user's pending key-registration operation was fixed. The successful diagnostic calls use a fresh official proof-provider wrapper, rather than exercising that application error wrapper.

## Lace boundary

The [signed-extension source review](lace-wasm-source-review.json) found a normal Lace 2.5.0 **On this device → Run in this app (WASM)** path for both wallet/DUST and DApp proving. The user reported selecting this setting. API 4 cannot attest it: both in-process and delegated TEE modes omit the deprecated prover URI. The application rejects any reported HTTP prover URL, including localhost, but cannot treat URI omission as proof of wallet privacy. No extension was patched, and no wallet secrets were read for this review.

`SHA256SUMS.json` describes the original local-attempt files byte-for-byte; the CI and transaction-diagnostic subdirectories carry their own manifests. The source snapshots contain code only, never serialized private witnesses, seeds, passwords, private keys or unproven transactions.
