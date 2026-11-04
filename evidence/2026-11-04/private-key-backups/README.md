# Private key files and Create/Join controls — 4 November 2026

The final browser reports bind to network bundle SHA-256 **`7d25abbb77c1d5ea1cc2bf9aad6aee46287188fdcb0ea6096b8d3ffac4add7a6`**. These checks cover local browser behavior and a separate unfunded Lace Preview connection. They do not establish restored-key transaction acceptance, public Preview proving or testing of the user's wallet.

| Evidence | What was executed |
| --- | --- |
| [network-browser.json](network-browser.json) | Eight Chromium scenarios passed: real SDK/WASM loading at root and repository paths; Create/Join view selection; private key-file controls; separate node/indexer request-abort cases; disabled-build and missing-WASM rejection. The expanded Lace setup guide and Generate tDUST instructions were checked at both paths. |
| Private key-file case in that report | Both administrator and voter keys were actually generated, revealed/hidden, downloaded, reloaded and masked. Eight invalid files per role were rejected without changing the existing key. The administrator key survived Create/Join view switches. Download bodies were checked transiently and not retained in evidence. No external requests or browser errors occurred. |
| [lace-connection.json](lace-connection.json) | A fresh isolated Lace 2.5.0 / API 4.0.1 wallet connected to Preview from 20:58:43 to 20:59:04 UTC. Eight connected-control checks, four Join checks, four return-to-Create checks and ten disconnect checks passed. The test generated disposable administrator/voter keys, then verified clearing, masking, visibility-control reset, cleared file inputs and disabled key downloads after disconnect. It made no private file downloads or screenshots. |
| [connect-real-lace-modes.mjs.txt](connect-real-lace-modes.mjs.txt) | Executed Lace harness snapshot; SHA-256 `7a97e09a59f2b0898fdd8f4ed0edacb414906bdc404c5a847f205d0e6099b9fc` matches its report. No wallet seed, application key or private state value is retained. |
| `private-controls-empty-*.png` and `lace-setup-guide-*.png` | Twelve captures at 1365, 390 and 320 pixels show the Create, Join, voter-key and expanded Lace-guide layouts. They were captured only after reloading and confirming that private inputs were empty. |
| [faucet-health.json](faucet-health.json) | Separate timestamped GET-only observations of the official faucet page, public script, health endpoint and Turnstile loader. Source inspection distinguishes browser challenge success from server token verification. No CAPTCHA token, wallet address or user screenshot was retained; no faucet request was submitted. These checks did not establish the cause or repair of the reported faucet failure. |

Versions: Compact 0.31.1, runtime 0.16.0, Midnight.js 4.1.1, Playwright 1.64.1 and Chromium 156.0.8078.4. The network-browser command used Node 24.18.0.

[before-setup-choice/network-browser.json](before-setup-choice/network-browser.json) preserves the preceding seven passing cases for bundle **`a5a24784e276fa34dc367027eebca8fdac1779150a56aa67d026a59faaa50b9e`**. That report predates the explicit Create/Join chooser and does not verify it.

Private `.txt` downloads are intentionally unencrypted, explicit user actions and separate from public election/receipt exports. This run did not execute a new public export against a joined contract; existing public projections were unchanged. The files contain only an administrator or voter key, not the network, contract address, trusted fingerprint, trustee secrets, wallet, SDK storage or pending-vote recovery state. Format validation does not authenticate a key's membership or authority. Full recovery in another browser followed by an accepted transaction remains untested, and an unconfigured deployment still cannot be recovered through Join.

No proof generation, signing, transaction submission, independent chain verification or hosted-origin wallet test was performed by these checks.
