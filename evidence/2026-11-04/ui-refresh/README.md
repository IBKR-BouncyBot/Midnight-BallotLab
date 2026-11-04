# Guide and navigation update — 4 November 2026

The application now links to styled how-it-works, technical, network and licence pages. The technical guides and legal text are generated from the maintained repository documents at build time. Source links open the GitHub repository. The four election stages use larger cards, a blue current-stage treatment and a two-column layout on phones.

Fresh local real-Chromium checks passed:

- [Focused interface checks](ui-browser.json): 34 cases covering actual native WASM loading, keyboard stage navigation and focus, draft/election retention, real guide/licence popups, source-link destinations, page anchors, exact licence content and 320/390/1440-pixel layouts. No browser/console/HTTP errors or external requests were observed. Six representative reviewed screenshots are retained here; all 19 captures remain in the task-local artifacts.
- [Native browser suite](native-browser.json): all seven scenarios, including the three trustee pairs, timed closing, suspension/resume after the deadline and missing-build/WASM rejection.
- [Network browser suite](network-browser.json): all four initialization and failure-handling cases. No wallet connection or transaction was attempted.

The initial native-suite launch could not find Chromium through the default browser cache. Its [failure report](native-browser-launch-failure.json) is retained separately. Configuring the runner to use the existing task-local Chromium installation resolved the environment issue; no application or cryptographic changes were needed.

The runs used Node 24.18.0, Playwright 1.64.1 and Chromium 156.0.8078.4. The existing real Compact 0.31.1 / runtime 0.16.0 output was bundled. These are local browser/runtime checks, not fresh circuit-proof generation or network-transaction evidence. Tests used a loopback origin with a repository-style URL prefix; no direct hosted-origin result is claimed. GitHub Pages publication runs its own compilation, generated-contract and browser gates.
