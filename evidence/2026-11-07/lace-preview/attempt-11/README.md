# Lace Preview attempt 11 — stopped before funding

[Run 42360729265](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42360729265) executed source `f6355f3c6a0894bee96a734090735ea8ca078c7a`. The browser report ran from **09:43:03.494 to 09:43:50.551 UTC on 7 November 2026** and remains **failed**.

The genuine signed Lace 2.5.1 wallet was created, the pinned reset-chain check passed before creation, the Midnight account and saved on-device WASM selection were observed, and application connection completed with API `4.1.0-canary.20260819082604-3b622cb`. This was a locally served app on the CI host, not the GitHub Pages origin.

The run then stopped at `check-wallet-indexer-before-funding`, category `public-service-request-failed`. The original report contains no HTTP status or upstream response body, so it does not establish a particular server response or cause. The recorded wallet service origins and paths include only query-key names; query values were not exported. A later service probe or diagnostic change must remain separate evidence.

The artifact contains **no funding request**. The original report and journal contain **zero application operations**; no funding, DUST registration, proof-entry window, signing or application submission was reached. Both the resource and function-entry observers remained armed without observations. Connection and saved mode selection do not establish wallet/DUST proving or backend attestation. The historical `fundingSource` label in the original report describes the runner's intended route, not an executed transfer.

[The original browser report](browser-report.json), [journal](public-journal.json), [signed acquisition metadata](lace-acquisition.json) and [workflow steps](workflow-progress.json) are retained byte for byte. [Provenance](provenance.json) binds the archive digest and executed source hashes; [file digests](SHA256SUMS.json) bind retained files. No private profile, wallet secret, raw browser log, request body or credential is included. No fix, new wallet-proof success or network acceptance is claimed.
