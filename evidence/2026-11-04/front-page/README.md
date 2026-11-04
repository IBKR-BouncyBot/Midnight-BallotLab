# Front page and testnet layout checks — 4 November 2026

These reports cover a locally served build: the homepage's Browser demo and Public testnet routes, the testnet activity layout, and support controls. They do not establish a live GitHub Pages check, a wallet connection, proof generation or accepted public-network transactions.

| Evidence | Executed checks |
| --- | --- |
| [native-browser.json](native-browser.json) | Nine Chromium scenarios passed: two homepage cases at root/repository paths, each opening both modes and reaching the actual SDK/WASM, plus all seven native election cases. Those cover all trustee pairs, receipt uploads and fresh-session checks, the real timed election with slowed setup, frozen-tab recovery after the deadline and two missing-prerequisite failures. The homepage made no public requests and loaded no runtime before a mode was chosen. |
| [network-browser.json](network-browser.json) | Eight real Chromium scenarios passed, including SDK/WASM loading at root and repository paths, Create/Join selection, private key-file controls, deliberate node/indexer request failures and missing-build/WASM rejection. |
| [layout.json](layout.json) | The activity layout passed at 1920, 1440, 1100, 768, 390 and 320 pixels without horizontal overflow or a clipped internal log. The support QR loaded and copying the address matched the existing browser-demo address. No browser errors or external requests occurred. |
| [review-network-layout.mjs.txt](review-network-layout.mjs.txt) | Exact executed layout harness; SHA-256 `4be179fef9a19294d9fbbc73770cadc3d2327b1a353f93b7cb4000cefbfa4f15`. |
| `activity-layout-sample-*.png` and `testnet-support-*.png` | Local layout captures. The activity entries are explicitly labelled synthetic public messages, used only to test layout with a long log. They are not transaction evidence. |
| `landing-empty-*.png` | Visually reviewed homepage captures at 1440, 390 and 320 pixels, before any election or wallet session. |

The layout harness inserts 30 labelled sample messages into a fresh, unconnected page. It does not change application state, enable wallet controls or bypass cryptographic checks. No user's wallet or private inputs were involved. Visual review covered the 1440-pixel activity capture and 390-pixel support capture.

The network bundle remains `7d25abbb77c1d5ea1cc2bf9aad6aee46287188fdcb0ea6096b8d3ffac4add7a6`; the native bundle remains `0a45a5d6367b06441b3c1b69bd78543aff97195c5ab6837b28169698f09e29b4`. The reports record Playwright 1.64.1 and Chromium 156.0.8078.4; the application still uses Compact 0.31.1, runtime 0.16.0 and Midnight.js 4.1.1. HTML/CSS hashes in the native-browser and layout reports identify the actual files exercised.
