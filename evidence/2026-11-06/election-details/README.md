# Election details and trustee file checks

Fresh execution on 6 November 2026 passed:

- [79 JavaScript boundary tests](boundary-tests.json), including eight election-file and six trustee-file format tests. These check parsing, canonicalization and export boundaries; they do not prove a network operation.
- [47 actual generated-native tests](native-tests.json), including three trustee-key tests using generated native public-key computation. The report separates contract, public-verification, receipt-ID and trustee-key counts and records source hashes. No proof generation or transaction submission occurred.
- [Eight real Chromium network browser cases](network-browser.json), with the actual SDK, two WASM assets and checked circuit assets. Valid public files only prefill the join form. Thirteen invalid-file variants plus a mismatch with the selected network are rejected without changing the fields, mode or network. Nothing joins automatically. Typed or imported details cannot enable election export. Trustee file controls remain disabled without a configured contract, including after actual local share generation.

The public-file screenshot values are deliberately inert form fixtures, not deployed contract addresses. Desktop and mobile controls were visually reviewed. The [390-pixel trustee layout check](trustee-controls-layout.json) verifies all three download buttons and the uploader fit, remain disabled and contain no private values; its screenshot shows empty, unconfigured state.

Configured-election downloads and successful private-trustee import/export were **not executed through a connected wallet in this browser run**. Format tests and actual native key matching cover their local validation logic; they are separate from accepted network transactions. Importing public details does not authenticate an election. Private trustee files are unencrypted and remain separate from public election-details files.

Reviewed implementation sources are [election-join.mjs](../../../src/election-join.mjs), [trustee-key.mjs](../../../src/trustee-key.mjs), [key-file-json.mjs](../../../src/key-file-json.mjs) and their integration in [network-app.mjs](../../../src/network-app.mjs). The native report records the helper source hashes. The browser report binds the final HTML/CSS and [test-network-browser.mjs](../../../scripts/test-network-browser.mjs), SHA-256 `ad3c302ac218ccd4336896b3ed69fd2a9e52adad1ecb1077d61cc99616f3c821`. Its network bundle is `06a730f885f7628b118379a00c11ddd4e58c372ee904196ae2c9ac5fceba7b35`.

Node `24.18.0`, Playwright `1.64.1`, Chromium `156.0.8078.4`, Compact runtime `0.16.0` and Midnight.js `4.1.1` were used. The reports retain counts and hashes rather than raw private-state output. No personal wallet, private key, proof witness, hosted-origin request or public-network transaction is retained or claimed here.
