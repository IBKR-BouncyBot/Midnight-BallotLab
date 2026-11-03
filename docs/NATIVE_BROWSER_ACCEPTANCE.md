# Native browser acceptance gate

`scripts/test-native-browser.mjs` drives a real headless Chromium browser using
Playwright. It requires the actual generated contract, a successful native
browser bundle, and the packaged Midnight WASM assets. Missing prerequisites are
failures. The script never enables the native build flag, creates generated
contract code, or supplies replacement cryptography.

Run from the repository root after installing the supported Compact toolchain:

```sh
npm --prefix contracts ci --ignore-scripts
npm --prefix contracts run compile:native
npm --prefix contracts run test:native
npm --prefix contracts run demo:native
npm run build
npm --prefix contracts run build:browser:native
python3 scripts/check_pages.py
node contracts/node_modules/playwright/cli.js install --with-deps chromium
node scripts/test-native-browser.mjs
```

The script starts its own loopback-only static server and closes it afterward.
The pinned Playwright dependency selects its matching browser revision; the
result report records both versions. `jsqr` independently decodes a screenshot
of the rendered receipt QR, and `pngjs` supplies its pixels. No camera permission
or external QR service is used.

The acceptance cases cover:

- Actual WASM loaded from the page origin at root and a GitHub repository path;
  the native `index.html` main experience and `native.html` entry both run.
- Invalid duplicate labels rejected before setup; actual key setup and five
  synthetic voter credentials enrolled through generated code.
- All candidate choices cast through the native UI, cleared after submission,
  and a sixth synthetic cast disabled.
- All trustee pairs, each finalizing the five-ballot aggregate to `[2, 1, 2]`.
- Downloaded receipt JSON and independently decoded QR round trips; altered
  address, election, configuration, receipt digest, index, network and malformed
  duplicate-key JSON rejected by the UI.
- Native public consistency checks, metadata commitment, explicit emulator/proof
  limits, and allowlisted public snapshot/ballot/trustee fields.
- Reset clearing the UI, rejection of receipts from the previous experiment,
  and no private session persistence in localStorage or sessionStorage.
- A 390-pixel mobile viewport without horizontal overflow, with a screenshot
  containing only the finalized public record and checks for visual review.
- Disabled native builds and unavailable WASM leaving every native control
  disabled. The failure tests only disable or abort resources; they never force
  successful initialization.

Evidence goes under `artifacts/native-browser/`: `result.json`, public snapshots,
and screenshots taken after choices have been cleared and public checks have
finished. The report includes generated-contract, bundle and WASM digests.
Raw browser console messages, runtime exceptions, Playwright traces and private
witness payloads are not persisted. A failed gate names its stage without
publishing those payloads. Diagnose failures locally while preserving that
boundary.

Passing this gate establishes browser execution of generated local runtime
code. It does **not** establish ZK proof generation, transaction submission or
acceptance, authenticated chain inclusion, real trustee separation, a camera
scan, a live GitHub Pages deployment, or election security certification. Do not
claim a passing run until the script has actually completed successfully; source
and syntax checks alone are not browser evidence.

API references: [Playwright browser launch](https://playwright.dev/docs/api/class-browsertype),
[download events](https://playwright.dev/docs/downloads),
[jsQR independent decoder](https://github.com/cozmo/jsQR).
