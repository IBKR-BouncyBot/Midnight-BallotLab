# Pages and browser proof gate — 6 November 2026

[Run 42311868015](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42311868015) passed for commit `3251fcc364114ac2c806a421df9910ad8303d6f8`. GitHub recorded deployment **7613382685** as successful at **2026-11-06T23:42:44Z**.

The unchanged [original proof report](browser-proof-evidence.json) records **eight standalone proofs across seven circuits**, **one genuine bound SDK `configureKeys` transaction proof**, both negative checks and zero forbidden requests or browser errors. The bound call used ordered `check`/`prove` callbacks with a binding override present, returning 4,853 proof bytes in 127,033 ms. The complete gate ran from 2026-11-06T23:32:01.898Z to 2026-11-06T23:42:17.419Z.

Compilation and the example passed, alongside 111 boundary tests, 62 generated native tests, 13 provider/worker tests, one actual-Ledger failure regression, nine native-browser cases and ten network-browser cases. Packaging checked 943 source files and 130 local references.

The [audit](deployment-ci-evidence-audit.json) verifies the small CI artifact digest, exact-head deployment metadata and unchanged runtime/worker/asset hashes against the [prior full Pages archive audit](../github-42276992287/README.md). The large Pages archive was not downloaded again; no fresh full source-archive comparison or direct hosted-origin request is claimed. [Provenance](provenance.json) retains both artifact IDs and GitHub-provided archive digests.

Recorded versions: Node 24.22.2, npm 11.19.1, Python 3.12.16, Compact 0.31.1, compact-runtime 0.16.0, Midnight.js 4.1.1, ledger 8.1.0, ZKIR 2.1.1, Playwright 1.64.1 and Chromium 156.0.8078.4.

No wallet was connected by this gate. It does not establish Lace wallet/DUST proofs, network submission or acceptance, or independent proof/chain verification. The separate manual Lace workflow and its browser-environment check have their own reports.
