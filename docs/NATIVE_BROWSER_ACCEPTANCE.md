# Native browser acceptance gate

`scripts/test-native-browser.mjs` drives a real headless Chromium browser using
Playwright. It requires the actual generated contract, successful native
browser and network bundles, and the packaged Midnight WASM assets. Missing prerequisites are
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
node scripts/build-network-browser.mjs
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

- The `index.html` introduction at root and a GitHub repository path, with both
  mode buttons reaching their actual `native.html` and `network.html` destinations.
  Native and network readiness use the real generated bundles and WASM.
- Actual native WASM loaded from the page origin in the `native.html` browser demo.
- Invalid labels/counts rejected before setup; actual key setup with 2, 3 and 5
  active choices and 3, 5 and 7 synthetic credentials across the cases.
- Private credential dropdown selection in nonsequential order; reused
  credentials disabled; choices cleared after submission; no identity mapping
  in the public record.
- All trustee pairs, each finalizing the complete native aggregate and checking
  the expected active totals and zero inactive lanes.
- Downloaded receipt JSON and independently decoded QR round trips; altered
  address, election, configuration, receipt digest, index, network and malformed
  duplicate-key JSON rejected by the UI.
- Receipt-ID lookup in the current election and a checked uploaded record,
  including a fresh browser context. A match must check the encrypted ballot's
  receipt binding; malformed, absent and ambiguous IDs must not report success.
  Changing the ID or selected record must clear the previous lookup result.
- Post-vote guidance for manual, timed and finalized elections, including saving
  the full receipt, keeping the timed demo open and obtaining the public record
  for later checking. Both demo pages must state that two cooperating trustees
  can decrypt individual ballots outside the app, before totals are revealed.
- Native public consistency checks, metadata commitment, explicit emulator/proof
  limits, and allowlisted public snapshot/ballot/trustee fields.
- Importing public JSON by upload/paste in a fresh browser context; no private
  credentials required; every voter's receipt checked; changed totals rejected;
  editing an import invalidates the selected verification context.
- A real 15-second scheduled local preview, with automatic closing and trustees
  1 + 3 finalization, plus an actual 18-second Chromium freeze/resume check across
  the deadline. These cases do not generate proofs or submit transactions.
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

Receipt-ID lookup checks only the selected record. It is not a network search,
proof of ballot ownership or an authentication of the election record. Keep the
full receipt, which carries the election and configuration context. Public
consistency and a receipt match do not establish fairness or prevent cooperating
trustees from decrypting individual ballots. New guidance and lookup behavior
require a fresh browser run; earlier passing reports do not verify these changes.

The [6 November voter-guidance evidence](../evidence/2026-11-06/voter-guidance/README.md)
records nine passing native/landing browser cases for the updated behavior,
alongside separate generated-ledger lookup tests and eight unconnected network
browser cases. It does not establish a new network receipt lookup or transaction.

API references: [Playwright browser launch](https://playwright.dev/docs/api/class-browsertype),
[download events](https://playwright.dev/docs/downloads),
[jsQR independent decoder](https://github.com/cozmo/jsQR).
