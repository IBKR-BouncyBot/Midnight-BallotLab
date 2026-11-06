# Passed proof gates; Pages publication cancelled — 6 November 2026

[Run 42310290799](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42310290799) built commit `3d8fe965dca6424c1500c876da1c7cc7c5b4759b` successfully, but deployment **7613197818** did not complete. The publish job ran from 23:28:50 to 23:38:52 UTC and was cancelled at its ten-minute limit. Its log recorded **116 `syncing_files` polls**, followed by `The operation was canceled.` The [unchanged log excerpt](publish-log-excerpt.txt) and [provenance](provenance.json) preserve this outcome; no specific backend cause is established.

The [original browser report](browser-proof-evidence.json) passed **eight standalone proofs across seven circuits**, **one genuine bound SDK transaction proof**, and both negatives, with zero forbidden requests or browser errors. The bound `configureKeys` proof took 126,947 ms. Compilation, the example, 111 boundary tests, 62 generated tests, 13 provider/worker tests, one Ledger-failure test, nine native-browser and ten network-browser cases also passed. Packaging checked **937 source files and 130 references**.

The [audit](incomplete-publication-audit.json) verifies the small CI artifact digest and unchanged native/network/worker/asset hashes, including 21 circuit assets, five parameter files and three network WASM files. It records the exact reviewed documentation and separate CI-fixture changes and deliberately reports `build-passed-deployment-cancelled`. The large Pages archive was not downloaded again. This is not successful deployment evidence; the preceding [cf18b45 deployment](../github-42299277893/README.md) succeeded with the same application runtime.

The official [deploy-pages v4 implementation](https://github.com/actions/deploy-pages/blob/v4/src/internal/deployment.js#L24-L53) caps its own timeout at 600,000 ms. Increasing its input to twenty minutes would not extend that cap. No timeout setting or retry was changed during this audit.

No hosted-origin request, Lace/wallet/DUST proof, network submission or accepted browser-wallet transaction is established by these CI reports. Separate wallet experiments retain their own outcomes.
