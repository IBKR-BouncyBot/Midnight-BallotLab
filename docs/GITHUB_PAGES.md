# Host Midnight Ballot Lab on GitHub Pages

Actual Lace 2.5.0 / API 4.0.1 completed nine local `undeployed` application transactions (eight native calls), finalizing `[0,1,0,0,0]`. See [wallet compatibility](NATIVE_NETWORK.md#wallet-compatibility) and [retained evidence](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/tree/main/evidence/2026-11-03/lace-wallet). A separate [Node Wallet SDK run on public Preview](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/blob/main/evidence/2026-11-06/public-preview-sdk/election-acceptance.json) completed nine accepted application transactions and eight proved contract calls. Browser-wallet transactions on Preview, wallet connection or transactions from the hosted GitHub Pages origin, and Preprod transactions remain untested; mainnet is blocked. Each run relies on its configured indexer and does not independently verify consensus.

The project is a static website: HTML, CSS and JavaScript execute in each visitor's browser. GitHub Pages can serve it without a backend, wallet, paid token or custom secret. It does not provide a shared election database, persistent private state, a Midnight node or a proof server.

The user selected [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab). The 0.6.1 deployment, hosted compatibility and isolated devnet acceptance completed successfully at `fa94c3a19b4791441208ceae54a121faff2c588b`. Direct HTTPS browser evidence for the [live application](https://ibkr-bouncybot.github.io/Midnight-BallotLab/) is tied to `b33b6e4896a12d211cc9b0040acdaf01c5a89ac5`; it is not a direct-origin test of later changes. Version 0.6.1 passed its actual browser suites on the CI runners; the separate devnet run confirmed 17 transactions and automatic closing/tallying through an external operator. See [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md) for exact run links, versions and evidence.

## Publish from the included source

1. Download and extract `midnight-ballot-lab-source.zip`.
2. Create a GitHub repository, or use one you own. Put the **contents** of the extracted `midnight-ballot-lab` directory at the repository root; do not nest that directory inside the repository. Include the hidden `.github` directory and `.gitignore`.
3. Push the files to `main` or `master`. GitHub Desktop or ordinary Git works. There is no need to upload `dist`, install npm packages or add a token secret.
4. In the repository, open **Settings → Pages → Build and deployment → Source**, then select **GitHub Actions**.
5. Open **Actions → Deploy GitHub Pages → Run workflow**, select `main` or `master`, and run it. **Native browser mode is required**: the workflow installs the pinned compiler/runtime using the reviewed dependency lockfile, compiles the native election, runs generated-contract tests and the native example, bundles the actual WASM runtime and Midnight.js network client, and exercises both browser entries in real Chromium. Subsequent pushes to either supported branch also run these gates.
6. After the deployment succeeds, open the URL shown in the workflow's `github-pages` environment or in **Settings → Pages**. For a project repository it normally has the form `https://OWNER.github.io/REPOSITORY/`.

The workflow also tests native input, receipt and provider boundaries, builds `dist/`, checks relative asset paths and the source download, and uploads only `dist/` to Pages. Pull requests run tests and build checks but cannot invoke the deployment job. Manual runs on other branches also verify without publishing. If your publishing branch has another name, update both the workflow triggers and the branch conditions in `.github/workflows/pages.yml`.

Recorded local and hosted executions compiled the native contract with Compact 0.31.1 and passed generated-runtime and real Chromium gates. Exact test counts, totals and source revisions are retained in the execution report; they are not automatically evidence for a new build. The [initial Pages workflow](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684485038) and its deployment passed; a further real browser run verified the actual HTTPS Pages URL. A compiler, test, bundle, browser or packaging failure fails the workflow before publication. Native compilation and browser gates are required for every deployment.

The website uses relative links and module imports, so the same build supports a project subdirectory, a user/organization Pages site, or a custom-domain root without changing a base URL. The build includes `.nojekyll`. Downloaded records remain local to the visitor unless they choose to share them.

## GitHub setup and visibility

GitHub Pages availability depends on the account plan and repository visibility. Ordinary Pages sites are publicly reachable even when their source repository is private; a private repository alone does not make the deployed website private. Check the actual Pages access configuration before publishing.

The workflow needs the automatically supplied `GITHUB_TOKEN`, with read-only source permissions for the build and `pages: write` plus `id-token: write` only in the deployment job. It does not need a personal access token. Organization policies and the `github-pages` environment may require an owner to enable Actions or approve a deployment.

GitHub Pages serves files; it does not interpret the `_headers` file generated for other static hosts. Browser-policy metadata in `index.html` can travel with the page, but server-only headers are not thereby configured on GitHub Pages.

## Local run on Windows, Linux or macOS

Install Node.js 22.12 or later and Python 3.9 or later. Fresh local execution used Node 24.18.0. Install the supported Compact toolchain (Linux/macOS, or Ubuntu in WSL on Windows), then from the extracted source directory:

```sh
npm test
npm --prefix contracts ci --ignore-scripts
npm --prefix contracts run compile:native
npm --prefix contracts run test:native
npm --prefix contracts run demo:native
npm run build
npm --prefix contracts run build:browser:native
node scripts/build-network-browser.mjs
python3 scripts/check_pages.py
node contracts/node_modules/playwright/cli.js install chromium
node scripts/test-native-browser.mjs
node scripts/test-network-browser.mjs
python3 -m http.server 8080 --directory dist
```

On Windows, use `python` or `py -3` in place of `python3`, according to your Python installation. Open `http://localhost:8080`; HTTPS or localhost is required for the browser's cryptography API. The private election session lives in browser memory and is lost on refresh. Public records and receipts can be exported first and imported in a fresh session for consistency checks. Imported files do not restore credentials or authenticate missing proofs.

The build order matters: `npm run build` recreates `dist/` and marks native/network bundles unavailable until their separate build commands succeed. The main page introduces the app and links to the browser demo and public testnet; it does not load either runtime before a mode is chosen. `native.html` loads the local Compact/WASM experience, which does not itself generate proofs or submit votes to a blockchain. `network.html` uses five separate screens within that one document; stage and control hashes reveal the correct screen without requiring server routes. Its transaction actions need a compatible wallet, selected development/test network and trusted local prover. Offline verification of a saved network record needs none of those connections. Browser initialization checks do not establish wallet or network transaction success.

## Native Midnight compatibility check

A separate manually triggered workflow, **Midnight contract compatibility**, installs the documented pinned Compact devtools/compiler and runtime, compiles `contracts/native-election.compact`, checks the generated artifacts and runs their emulator tests. It also runs the native five-ballot example and the same browser gates. Both workflows retain exact tool versions, compiler/test/build logs, public browser evidence, the public emulator snapshot, the toolchain manifest, installed dependency tree and reviewed lockfile for 30 days. If a step fails, the workflow fails; it does not convert missing prerequisites into a successful compatibility result.

The [compatibility workflow passed on GitHub](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684474674). It also ran `node contracts/native/prove-local.mjs` against an explicitly loopback-bound proof server 8.1.3, producing eight real proofs across all seven circuit types and passing both negative checks. This is standalone circuit proving, without a wallet or accepted network transaction; it is not independent proof verification. The retained hosted proof report is `evidence/2026-11-03/github/native/reports/native-proof-evidence.json`. Neither the Pages nor compatibility workflow submits a transaction or claims election certification. See [CI continuation](CI_CONTINUATION.md), [Native Midnight implementation](NATIVE_MIDNIGHT.md) and [Midnight compatibility](MIDNIGHT_COMPATIBILITY.md).

The runtime's direct versions and generated dependency lockfile are included. The workflows require `npm ci`; they cannot silently regenerate a missing lockfile. Retain and review lockfile changes during dependency maintenance.

## Separate local-devnet acceptance

The manual **Local devnet transaction acceptance** workflow starts the pinned official local node, indexer and prover and executes the real wallet/provider election with the separate reviewed devnet lockfile. Its same acceptance path passed locally on 3 November 2026: all 17 transactions were confirmed `SucceedEntirely` by the configured local indexer, with 16 completed proof transactions, five matching receipts and final tally `[2,1,2]` at block 100. Four invalid operations were rejected before proof/submission. The contract address, configuration digest and complete public transaction list are retained in the [public devnet report](../evidence/2026-11-03/public/devnet-network-evidence.json).

The [hosted devnet workflow also passed](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41684480267), confirming another 17 transactions and 16 proof transactions on its own fresh chain, finalizing `[2,1,2]` at block 99. Its public address and transaction list are recorded separately in [GITHUB_EXECUTION.md](GITHUB_EXECUTION.md). Services were stopped after verification and are not persistent hosted infrastructure. This Node wallet acceptance path does not validate the separate browser-wallet flow or independently authenticate chain inclusion. GitHub Pages serves the main local native WASM experience and the separate network client; it supplies none of these network services.

## Verification scope

The [five-screen testnet evidence](../evidence/2026-11-06/testnet-step-screens/README.md) records the current navigation checks, exact runtime/harness hashes, responsive captures and the corrected history regression. The Pages workflow runs the updated network-browser harness alongside the native-browser suite before publishing. Local browser results and GitHub workflow/deployment results remain distinct.

Hosted workflow execution, live HTTP assets/headers and real browser behavior at the deployed project URL have separate retained evidence. The live browser run verifies the local WASM experience and the network client's no-wallet behavior; the separate local Lace browser-wallet election passed; hosted-origin wallet transactions remain untested. Network acceptance has separate isolated-devnet and public Preview Node Wallet SDK reports. The public SDK run does not establish hosted-origin wallet behavior, and authenticated public election verification requires more than an indexer response.

## Official references

- [GitHub: custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub: create a Pages site and visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [GitHub: Pages hosting model and URL forms](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Midnight: install the toolchain](https://docs.midnight.network/getting-started/installation)
- [Midnight: pinned Compact devtools 0.5.1 release](https://github.com/midnightntwrk/compact/releases/tag/compact-v0.5.1)
