# Receipt filenames and saved-record uploads — 2026-11-06

Fresh verification passed on the final build:

- [Native browser suite](native-browser.json): **9/9 cases**, using the actual generated contract and WASM. Each of the three trustee pairs completed its election. Receipt filenames matched the casting demo voter, including voter 1 followed by voter 3, rather than the ballot's position. Selecting another voter before saving preserved the preceding receipt and filename. Every downloaded receipt had only the approved public fields; QR and public-record checks remained intact. Actual timed voting and resume-after-deadline flows also passed, without substituting the clock or bypassing contract checks.
- [Network browser suite](network-browser.json): **9/9 cases**. Repeated downloads of the same real generated key kept its number. Renamed imports preserved a known label; an original filename restored its label in a fresh browser context. Reserving the imported numeric counter prevented the next key from reusing that number. Storage contained only the nonsecret counter, not keys or a key-to-file mapping. Counter failure fallbacks stayed stable for an existing key and allocated different labels for new keys.
- The network suite freshly verified the exact [historical public observation](../../2026-11-03/lace-wallet/attempt-2/public-indexed-observation.json) locally, with its hash recorded in the report. Ten changed or invalid files were rejected: receipt, point, aggregate, totals, extra private field, malformed JSON, duplicate field, invalid UTF-8, excessive size and wrong extension. Each rejection cleared the preceding successful result. Importing an undeployed-network record kept Preview selected, preserved the join fields and left all network actions disabled. It did not connect a wallet or contact a service.
- [Local tests](local-tests.json): **101/101 boundary, 62/62 generated-native and public-verification, 10/10 installed-provider/API tests**. The report records exact commands, source and output hashes, and the unchanged runtime bundles. The exact [runner](run-final-checks.mjs.txt) is included.

These runs generated no cryptographic proofs and submitted no network transactions. Fresh offline verification of a historical record is not new network acceptance or independent chain verification. The network receipt filename after a genuine wallet cast was not exercised again here; its filename helper/session behavior and the actual native-browser cast filenames were tested separately. A filename label is a convenience, not evidence of voter identity. Voter numbering was not added to receipt JSON, QR data or public election records.

The uploaded-record checks establish internal consistency of the file. They do not establish that it is authentic, complete or current, or prove eligibility, genuine trustee contributions, fairness or blockchain acceptance. Reviewed [desktop](saved-public-record-1440.png) and [mobile](saved-public-record-390.png) captures show those limits and contain only public record information. No clipping or horizontal overflow was observed. No private key values, downloaded private bodies or witness data were retained in these reports or screenshots. No hosted origin was requested.

Tested versions: Node **24.18.0**, Playwright **1.64.1**, Chromium **156.0.8078.4**, Compact compiler **0.31.1**, Compact runtime **0.16.0**, Midnight.js **4.1.1**.

| Artifact | SHA-256 |
| --- | --- |
| Native runtime bundle | `dde3b295e04a4058113bfa55d3b7c49b0104e122c775568f37622dda4f3ca5a9` |
| Network runtime bundle | `7bf7abf93455001eaa0f3f6c4dfbf35a6df8edd79ee3d64876c5ded6d0ae1ed0` |
| [Native browser harness](test-native-browser.mjs.txt) | `163a74004366153da2c94187fb8abd6266875a6507db01c278ce56cdd07c57d5` |
| [Network browser harness](test-network-browser.mjs.txt) | `80b1a24965b717df2b33e6a6d76a2b46482064b9f4ee95211bc6174153bc786f` |

To reproduce the browser checks from the built repository, use the matching scripts at `scripts/test-native-browser.mjs` and `scripts/test-network-browser.mjs` with `PLAYWRIGHT_BROWSERS_PATH` set to the installed `.browser-cache`. Both serve `dist` over loopback in isolated browser contexts. Earlier evidence folders remain unchanged.
