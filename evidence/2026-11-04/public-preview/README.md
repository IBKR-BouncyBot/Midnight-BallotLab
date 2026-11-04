# Public Preview connection — 4 November 2026

The network page now selects Midnight Preview and its official public indexer by default. It offers an explicit, read-only public-service check and checks Preview before wallet connection. Loading the page makes no automatic public-network request. The existing native Midnight contract, wallet proving and submission providers remain in use; mainnet and remote proving remain blocked.

## Fresh execution

- [Public service probe](services.json): the RPC identified itself as `Midnight Preview`, node `1.0.400-87c0fbdb`; HTTP indexer query and WebSocket connection acknowledgement passed. This first probe did not start a subscription.
- [Real Chromium service check](browser-services.json): actual cross-origin RPC and HTTP-indexer reads passed, followed by an actual public-block WebSocket subscription. The retained run observed block `1599911`. No responses were mocked. Desktop 1440 and mobile 390/320 layouts passed, with zero browser errors and no unexpected requests; reviewed screenshots are retained here.
- [Network browser suite](network-browser.json): four cases passed with the real SDK, two WASM assets and 21 circuit assets. Checks include Preview defaults, advanced-network switching, required inputs, absence of automatic public requests, no-wallet rejection and missing-build/WASM rejection.
- [Actual Lace connection](lace-connection.json): official Lace 2.5.0 / DApp Connector API 4.0.1 connected an empty disposable wallet to Preview through the real application and authorization popup. The app's preflight passed. All five connected-control checks and all five disconnect checks passed; the password was cleared and the browser closed. Wallet-reported services use Lace's built-in `blockfrost.lw.iog.io/midnight-preview` service paths, separately from the app's official Midnight indexer.

Root `npm test` passed all 56 cases, including ten new public-service/network-boundary checks. The installed official SDK bootstrap tests also passed three cases. The final local package check passed both root and repository-subdirectory URL layouts. GitHub Pages independently runs compilation, generated-contract tests and browser gates before publishing.

The initial browser requests were denied by the execution sandbox, as retained in [the browser diagnostic](browser-network-denied.json); the [initial Lace attempt](lace-connection-initial-failure.json) stopped at the service preflight. Approved public-network execution passed without changing application logic, Chromium security or endpoint validation. Those failures are not relabeled as successes.

## Exact scope

These checks used locally served application pages and the actual public Preview services. They establish service access and a real wallet connection, not a complete public election. The disposable wallet was not funded. No proof-server request, transaction signing, submission or accepted public transaction occurred. The local prover URL was inspected, not its runtime availability. Hosted GitHub Pages-origin wallet permission behavior and independent chain inclusion remain unverified.

A full public election still needs a Preview wallet funded through the faucet, its human CAPTCHA, DUST registration and usable test DUST, and a running local proof server 8.1.3. The previously verified complete nine-transaction Lace election remains separate local-development-network evidence.

Tested versions: Node 24.18.0, Lace 2.5.0, connector API 4.0.1, Playwright 1.64.1, Chromium 156.0.8078.4, Midnight.js 4.1.1, Compact 0.31.1 and compact-runtime 0.16.0. The final tested network bundle SHA-256 is `32da2efea1ac76e819cf5c746a0cac2deb7d7ec6997c8ac736989514bf7c3549`. The [retained connection harness](connection-runner.mjs.txt) matches the hash in the successful connection report and contains no seed, password, witness or private wallet state.
