# Network stages and election timing — 2026-11-06

Fresh local verification passed on the final build:

- [Network browser suite](network-browser.json): **8/8 cases**, including actual SDK and two WASM assets, root/project-prefix loading, no-wallet gates, public election-file imports, real local key generation and private-file boundaries, abort-only service failure checks, and unavailable-build failures. No successful wallet or service response was fabricated.
- [Navigation browser checks](navigation-browser.json): **2/2 cases**, at 1440px and 390px. Each of the four stage links worked with Enter and pointer activation, moved focus to its heading, and preserved the public form input without reloading. The checks shortcut also worked. The activity panel remained sticky on desktop and used normal page flow on mobile. No horizontal overflow, page errors, console errors or external requests occurred.
- [Boundary tests](boundary-tests.json): **85/85**, including six timing-display tests. These cover JavaScript boundaries and formats, not native proof generation.
- [Generated-native tests](native-tests.json): **49/49**, including two timing-display tests over real generated-contract lifecycle states. The [retained output](native-tests.log) and source hashes identify that execution separately from the browser checks.

The browser showed the genuine unjoined state: “No election connected”, empty schedule values and “Election record not loaded yet.” Those values stayed unchanged across an actual 1200ms display-clock observation. No wallet, ledger state or clock was injected, and no polling request occurred. A connected-browser countdown was not exercised in this run. The generated-native timing tests separately cover actual contract lifecycle snapshots. None of these runs generated a cryptographic proof, submitted a transaction or established network acceptance.

Tested versions: Node **24.18.0**, Playwright **1.64.1**, Chromium **156.0.8078.4**, Compact compiler **0.31.1**, Compact runtime **0.16.0**, Midnight.js **4.1.1**. Network bundle SHA-256: `eb612da75debf7dd27e0b15839fe964ac1e6371e128a9212ae9e1fa33836454c`. The navigation report also records the tested HTML and three CSS hashes.

The exact [navigation harness](check-navigation.mjs.txt) has SHA-256 `886f91cc61ee04a4e9bbaf39be467bbae8bc88ea730a5f4ccf6fec7edef5d911`. To reproduce after building both bundles, copy it to `artifacts/network-stages/check-navigation.mjs` and run `node artifacts/network-stages/check-navigation.mjs` from the repository root. It uses the task-local `.browser-cache`. The full suite command is `node scripts/test-network-browser.mjs` with `PLAYWRIGHT_BROWSERS_PATH` set to that cache; that script's SHA-256 is `ad3c302ac218ccd4336896b3ed69fd2a9e52adad1ecb1077d61cc99616f3c821`.

Reviewed screenshots contain no private inputs or wallet data:

- [Desktop navigation](network-stage-navigation-1440.png)
- [Mobile navigation](network-stage-navigation-390.png)
- [Unjoined activity timing](activity-timing-unjoined-390.png)

All browser requests were confined to a loopback server. No hosted origin was requested. Historical evidence in other folders remains separate.
