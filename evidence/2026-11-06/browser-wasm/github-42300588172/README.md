# Passed proof gates; Pages publication cancelled — 6 November 2026

[Run 42300588172](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42300588172) built commit `e22832c2424cf89c8756e3156e943b1f87021469` successfully, but deployment **7612041556** did not complete. The publish job ran from 22:13:42 to 22:23:45 UTC and was cancelled at its ten-minute limit. Its log recorded **114 `syncing_files` polls**, followed by `The operation was canceled.` The [unchanged log excerpt](publish-log-excerpt.txt) and [provenance](provenance.json) preserve this outcome; no specific backend cause is established.

The [original browser report](browser-proof-evidence.json) passed **eight standalone proofs across seven circuits**, **one genuine bound SDK transaction proof**, and both negatives, with zero forbidden requests or browser errors. Compilation, the example, 111 boundary tests, 62 generated tests, 13 provider/worker tests, one Ledger-failure test, nine native-browser and ten network-browser cases also passed. Packaging checked 897 source files and 132 references.

The [audit](incomplete-publication-audit.json) verifies the small CI artifact digest and unchanged runtime/worker/asset hashes. It deliberately records `build-passed-deployment-cancelled`; it is not successful deployment evidence. The large Pages archive was not downloaded again. The preceding [cf18b45 deployment](../github-42299277893/README.md) succeeded with the same application runtime.

The official [deploy-pages v4 implementation](https://github.com/actions/deploy-pages/blob/v4/src/internal/deployment.js#L24-L53) caps its own timeout at 600,000 ms. Increasing its input to twenty minutes would not extend that cap. No timeout setting or retry was changed during this audit.

No hosted-origin request, wallet/DUST proof, network submission or accepted browser-wallet transaction is established by these reports.
