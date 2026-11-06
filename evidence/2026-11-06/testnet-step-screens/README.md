# Five testnet screens — 2026-11-06

The public-testnet interface now shows one of five mounted screens at a time: Connect, Set up election, Vote, Reveal results and Verify election. Navigation preserves the session and existing forms; it does not call a provider, send a transaction or advance the contract phase. Action-specific checks remain in place.

Fresh checks:

- [Network browser suite](network-browser.json): **10/10 cases passed** against the final network bundle. The added navigation case exercised widths of 1,440, 1,100, 390 and 320 pixels. It checked exactly one visible panel, selected-stage ARIA, keyboard and pointer navigation, Back/Next, preserved public and private inputs, masking state, saved-record results, sidebar/readiness links, initial and nested deep links, browser Back/Forward, and a return to the initial URL without a fragment. Navigation remained disabled during the two deliberately aborted service checks and recovered afterward. Missing native prerequisites still disabled the controls.
- [Native browser suite](native-browser.json): **9/9 cases passed**, including each trustee pair, actual timed closing, resume after a deadline, receipt filenames and public checks. The native bundle remained unchanged throughout. This run's landing-page checks loaded the initial network bundle before the fragment-focus correction; that hash is explicitly retained in its report. The final network bundle was then checked separately by the complete network suite above.
- [Local tests](local-tests.json): **101/101 boundary, 62/62 generated-native/public-verification, and 10/10 installed-provider/WASM tests passed**. The report records exact commands, versions, output digests and unchanged source/build hashes. The exact [runner](run-final-checks.mjs.txt) is retained.

The first network run exposed a real browser-history defect: a direct fragment pointing to a disabled action could leave focus on the document body and the owning screen heading above the viewport. The settled [failing report](before-hash-fix/network-browser.json) and [executed harness](before-hash-fix/test-network-browser.mjs.txt) are retained. The controller now handles the subsequent `hashchange` even when `popstate` has already seen the same fragment, so browser fragment scrolling cannot leave the fallback heading unfocused. The final suite checks both focus and heading visibility; no action gate was bypassed.

Reviewed [desktop](network-screens-1440.png) and [mobile](network-screens-390.png) captures show the selected screen and Midnight blue navigation. No horizontal page overflow was observed at any tested width. Private fields were cleared before screenshots. Test reports retain no private key values, downloaded private file bodies or witness data. The fixture used for offline record verification remains the exact historical local-devnet public observation; rechecking it is not a new accepted transaction.

These checks generated no cryptographic proofs and submitted no network transactions. No wallet or fabricated success provider was injected. Service failures used request abortion only. No hosted Pages origin was requested. Saved-record verification establishes supplied-record consistency, not authenticity, fairness or independent chain inclusion. Historical proof and accepted-network evidence remains separately scoped.

Current documentation was reviewed across the README, application guide, native/network/provider guides, build/deployment instructions and threat/verification boundaries. Outdated navigation instructions and stale current-behavior descriptions were corrected; historical reports retain their original results and source scope.

Tested versions: Node **24.18.0**, Playwright **1.64.1**, Chromium **156.0.8078.4**, Compact compiler **0.31.1**, compact-runtime **0.16.0**, Midnight.js **4.1.1**.

| Artifact | SHA-256 |
| --- | --- |
| Final native runtime bundle | `dde3b295e04a4058113bfa55d3b7c49b0104e122c775568f37622dda4f3ca5a9` |
| Final network runtime bundle | `4763a17dd7106bfc262b4d713dd8526db6c34fd3bdd4e9ee1a5a42ef14c422df` |
| [Native browser harness](test-native-browser.mjs.txt) | `163a74004366153da2c94187fb8abd6266875a6507db01c278ce56cdd07c57d5` |
| [Network browser harness](test-network-browser.mjs.txt) | `80d9728cb3a97686420474ae262410571fdced0abcfa61271b1a423021f6f7bd` |

To reproduce, build the static site and both real browser bundles, then run `node scripts/test-native-browser.mjs` and `node scripts/test-network-browser.mjs`. Set `PLAYWRIGHT_BROWSERS_PATH` to the installed browser cache when needed. Both serve the app over loopback in isolated Chromium contexts. GitHub Pages CI also compiles the contract, runs the generated election example and executes both browser suites before deployment.
