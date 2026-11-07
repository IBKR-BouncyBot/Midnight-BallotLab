# Corrected landing gate; later network-browser failure

[Pages run 42361101178](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42361101178) tested `55fa7f074e91885c9cd3587c7b33091f1c1ae529` on 7 November 2026. Its **nine native browser cases passed**, including the corrected landing-to-testnet check. The [original native report](native-browser-result.json) is retained unchanged.

The network browser gate then **failed** at `preview-node-transport-failure:request-cleanup` (09:50:47–09:51:26 UTC). Its [original report](network-browser-evidence.json) records six earlier passing cases. The deliberate failure case observed three targeted node requests and four blocked requests, with zero unexpected requests, page errors or unexpected console errors. These were aborted test requests; this is not evidence of a public-service outage or wallet transaction failure.

Source review found the test still expected the earlier single-node-request preflight, while the current chain-identity guard starts three node requests and one indexer request. A subsequent test correction requires fresh browser execution; it does not change this recorded failure or weaken the abort-only boundary.

The compiler/build checks, 116 root tests, 63 generated-native tests, 23 provider/module/inspector tests and one Ledger callback-failure regression passed. The browser-proof gate did not execute and deployment was skipped. No Pages site artifact was uploaded. The [audit](failed-build-audit.json) records exact counts and matching local/CI bundle bytes and five split-module hashes, alongside five network WASM assets and 21 circuit assets.

[Provenance](provenance.json) binds the verified public artifact digest and [file digests](SHA256SUMS.json) bind the retained originals. No hosted-origin request, workflow retry, new wallet/proof execution or transaction submission was performed by this audit. The failed run is separate from the earlier local proof success and from any later corrected run.
