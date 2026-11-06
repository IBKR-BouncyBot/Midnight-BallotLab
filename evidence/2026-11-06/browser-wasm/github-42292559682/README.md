# Pages and real browser proofs — 6 November 2026

[Run 42292559682](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42292559682) passed for commit `af1ba1dcc9a636204fe0f8a3b44c0f4ff64e37fc`. GitHub recorded deployment **7610884244** as successful at **21:09:43 UTC**.

The original [browser proof report](browser-proof-evidence.json) records eight standalone proofs across seven circuits, one genuine SDK `configureKeys` transaction proof through the production provider, and two negative checks. The bound transaction used the actual ordered `check`/`prove` callbacks, with a binding override present, and returned 4,853 proof bytes in 93,321 ms. The complete proof gate ran from 21:01:45.587 to 21:09:16.620 UTC with zero forbidden requests or browser errors. No witness, binding value or transaction payload is retained.

Compilation and the example passed. CI also passed 111 boundary tests, 62 native tests, 13 provider/worker tests, one actual-Ledger failure regression, nine native-browser cases and ten network-browser cases. Packaging checked 830 source files and 132 local references.

The [audit](deployment-ci-evidence-audit.json) verifies the small CI artifact digest and exact-head deployment metadata. Its reported native/network bundle, worker, manifest and asset hashes match the [previous full Pages archive audit](../github-42276992287/README.md). The large Pages archive was not downloaded again; this report does not claim a fresh source-archive byte comparison or a direct request to the hosted app. [Provenance](provenance.json) records both artifact IDs and GitHub-provided archive digests.

Recorded versions: Node 24.22.2, npm 11.19.1, Python 3.12.16, Compact 0.31.1, compact-runtime 0.16.0, Midnight.js 4.1.1, ledger 8.1.0, ZKIR 2.1.1, Playwright 1.64.1 and Chromium 156.0.8078.4.

This gate used no wallet. It does not establish Lace wallet/DUST proving, a public Preview submission or accepted transaction, or independent proof/chain verification. The separately funded [Lace attempt 3](../../lace-preview/attempt-3/README.md) remains distinct.

The preceding [621164d deployment](prior-pages-deployment.json), run **42291235974**, also succeeded at **21:08:04 UTC**. Only its GitHub run/deployment metadata is retained here.
