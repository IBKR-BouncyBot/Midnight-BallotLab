# Public service request policy checks

The [result](result.json) records 36 passing checks against the exact pure policy functions extracted from the CI runner. Its runner and harness hashes identify the tested source; [tested-harness.txt](tested-harness.txt) retains the executed harness unchanged. These checks ran in a Node VM without a browser, wallet, network request, proof or transaction.

The checks cover the signed Lace public configuration request, rejected extra or private fields, wrong installation metadata, malformed JSON, failed or partial feature responses, exact Preview endpoint restrictions, HTTP-prover rejection and removal of query values from reports. The harness reads the official extension's bundled public client token in memory and compares its hash; it never prints or retains that token or an installation identifier.

This is request-policy evidence only. The manual browser run must still observe Lace loading its own normal configuration, verify the wallet's reported services, complete actual HTTP/WebSocket service checks and receive an empty-wallet balance response before publishing a funding request. Only later accepted transactions can establish the complete browser-wallet flow. API 4 does not attest the wallet proving mode.

The original harness ran from `artifacts/lace-preview-policy-check/check-policy.mjs` with the acquired signed package at `artifacts/lace-2.5.1-review/extension/`. Its relative imports and inputs refer to those project-local paths.
