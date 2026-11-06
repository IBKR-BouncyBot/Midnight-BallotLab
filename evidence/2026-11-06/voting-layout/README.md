# Voting layout checks

Fresh local Chromium checks on 6 November 2026 passed all eight existing network browser cases: see [network-browser.json](network-browser.json). Only the assertion for the removed standalone trustee-information section was deleted; receipt checks, real WASM/circuit-asset checks, private-key handling and wallet/failure gates remain covered.

[layout-browser.json](layout-browser.json) records six lightweight checks of the native and network voting sections at widths 1440, 390 and 320. Both actual runtimes initialized, with no page errors or external requests. Voting remained disabled, no choice was selected, and receipts stayed hidden. The two 390-pixel screenshots show empty, public-safe state. The native capture was reviewed by the root reviewer; the browser reviewer also reviewed the corrected network capture. Capture viewport sizing was adjusted to avoid Chromium's fixed skip-link artifact without changing application state or CSS.

The report contains the exact tested HTML, stylesheet and bundle hashes, including `overview.css` SHA-256 `7f28da07006bd919e8a1371582df05ff8721639ae9a9a5d8080da7843e55fcb3`. The shared stylesheet hash was recorded after the check from the same unchanged build. Node `24.18.0`, Playwright `1.64.1` and Chromium `156.0.8078.4` were used.

This focused check covers a section removal and layout. It does not repeat the full native election suite or claim wallet connection, proof generation, network submission, accepted transactions or hosted-origin verification. No personal wallet or private values were used in these layout captures.
