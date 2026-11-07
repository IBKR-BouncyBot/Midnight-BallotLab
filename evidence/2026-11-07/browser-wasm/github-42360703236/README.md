# Ledger-9 Pages build failure — 7 November 2026

[Run 42360703236](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42360703236), at `f6355f3c6a0894bee96a734090735ea8ca078c7a`, failed the native browser gate. Deployment was skipped; no Pages site artifact was uploaded.

The exact retained logs establish 116 root-boundary tests, 63 generated-native tests, 23 installed-provider/module/inspector tests and one Ledger callback-failure regression passed. Native compilation/key generation, both browser bundles and packaging passed (147 local references, 1,045 source files). The CI environment used Node 24.22.2, npm 11.19.1, Python 3.12.16, Compact 0.36.0, compact-runtime 0.21.0, Playwright 1.64.1 and Chromium 156.0.8078.4.

The [original browser report](native-browser-result.json) failed at `landing:/:testnet:actual-destination` with `AssertionError`, from 09:42:53 to 09:42:56 UTC. Its completed-case array is empty: no native election case is claimed. The report identifies the assertion block, not an individual assertion or an application root cause. Source review found an obsolete four-WASM startup expectation within that block; a correction requires a fresh browser execution and does not change this failure.

Network browser and browser-proof gates did not run. The [audit](failed-build-audit.json) records matching local/CI native and network bundle bytes, five split module records, five network WASM assets and 21 circuit assets. This byte comparison does not convert the failed browser gate into a pass.

[Provenance](provenance.json) records the verified public artifact digest; [file digests](SHA256SUMS.json) bind the exact retained originals. No hosted-origin request, workflow retry, wallet access, proof generation or transaction submission was performed by this audit. The separately completed local browser proof run remains distinct evidence.
