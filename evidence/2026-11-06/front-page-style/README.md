# Landing style browser checks

Fresh local Chromium verification on 6 November 2026 passed all six combinations of `/` and `/Midnight-BallotLab/` at widths 1440, 390 and 320 pixels. The final run began at `2026-11-06T08:07:05.151Z`; see [landing-browser.json](landing-browser.json).

- No horizontal overflow, orbit illustration or empty hero graphic column; the hero uses one text column.
- Rendered text, surfaces, borders and shadows use neutral colors or Midnight blue. Both demo actions compute to `rgb(0, 0, 254)`; the body computes to `rgb(10, 10, 10)`. Desktop card hover states were checked too.
- Both relative demo links load their actual native/network bundles and WASM at every width and path. The browser link was activated with Enter; the testnet link with a pointer.
- The landing page makes no external request, discovers no wallet, and loads no cryptographic runtime before a demo is chosen. All twelve destination loads reached their actual ready state without browser errors or external service requests.
- Desktop and 320-pixel screenshots were visually reviewed by the browser reviewer; desktop and 390-pixel captures were also reviewed by the root reviewer. The final capture waits for the existing lazy-loaded support QR to load normally before taking the full-page image.

The six `landing-{root,project}-{1440,390,320}.png` files contain public, empty application state. Node `24.18.0`, Playwright `1.64.1`, Chromium `156.0.8078.4` were used. The report records exact HTML, stylesheet and bundle hashes. Native bundle `9eab45976edf646eaf2d1c360ce238fb7ca487a959d199eb05a4c12752bb105a` and network bundle `55939740a81c9f195b52e3036d83ecfea3e21194bcf95944f2e56b9e401cb637` are unchanged from the preceding voter-guidance checks.

The exact one-off harness is retained as [check-landing.mjs.txt](check-landing.mjs.txt), SHA-256 `14bf482242ba11fe74e1841f503d6c189f2e88e27e4e17ffc7e6cfc19e96b4be`. To reproduce, copy it to `artifacts/front-page-style/check-landing.mjs` and run `node artifacts/front-page-style/check-landing.mjs` from the repository root after building both actual bundles. It uses the repository's `.browser-cache` and a loopback static server.

These checks cover landing presentation and real destination initialization. They do not repeat full election flows or establish wallet connection, proof generation, accepted transactions or a deployed-host check. No hosted origin, personal wallet or public network was contacted.
