# GitHub CI continuation

Reviewed against the source on 3 November 2026. These are workflow changes, not a claim that GitHub has executed them.

## Required inputs

Use the user's selected [IBKR-BouncyBot/Midnight-BallotLab](https://github.com/IBKR-BouncyBot/Midnight-BallotLab), with the application contents at its root. Enable GitHub Actions and select **GitHub Actions** as the Pages publishing source. The workflow supports `main` and `master`; a different release branch needs corresponding trigger and deployment-condition changes. The bundle contained no repository selection; the user supplied this target during the continuation. Authenticated access and hosted execution remain pending.

The workflows use Ubuntu 24.04, Node 24 and Python 3.12. The installer reads the toolchain pins from `contracts/toolchain.json`, verifies the pinned official devtools installer's SHA-256 before executing it, and requests the explicit compiler version. A reviewed `contracts/package-lock.json` is required; CI uses `npm ci --ignore-scripts` and fails when the lockfile is absent or inconsistent. No wallet credentials or GitHub personal access token belong in these workflows.

The compatibility workflow also installs the separate reviewed `contracts/devnet/package-lock.json` and runs its 20-case generated-runtime compatibility suite. That step stages byte-identical source/bindings under the wallet dependency graph; it does not initialize a wallet, start a development chain or submit a transaction. Application and devnet dependency evidence remains separate: the final application audit reports zero vulnerabilities; the devnet graph retains eight moderate testkit/transitive archive/glob findings after its high-severity `ws` issue was corrected with 8.22.1. See the current lockfile reviews referenced in [CONTINUATION_RESULTS.md](CONTINUATION_RESULTS.md).

## Manual local-devnet acceptance

The separate `devnet-acceptance.yml` workflow, **Local devnet transaction acceptance**, is manual only and has a 30-minute job timeout. It installs both reviewed graphs, compiles the actual contract, runs both generated-runtime suites, starts a fresh local node/indexer and a loopback proof server, then runs `contracts/devnet/run-election.mjs --isolated-local-devnet`. The election waits for actual block time and uses the official local genesis fixture in memory; it requires no public-network funds, user seed or repository wallet secret. No hosted success is claimed before the workflow actually runs.

The service helper retains version tags while verifying their exact `RepoDigests` before creating any resource: node 1.0.400 at `sha256:915b117f955859a0ab7f34230ca12b43ef7474c84e29463256efcfc7b757040f`, indexer 4.3.5 at `sha256:1c69c6632df859140a4019af9d7ebb81cb6073b1d39194d3eabaa1b320883499`. Proof server 8.1.3 is pinned directly to `sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c`. All host ports bind to loopback. Node/indexer/prover log storage is disabled; no raw container logs, request bodies, wallet state or private database are uploaded.

An `always()` cleanup stops and removes only the three exact task-owned names after checking their ownership labels, then removes the labeled network. Public stage logs, image digests, readiness, lockfiles and the allowlisted transaction report are retained for 30 days, including a partial report if acceptance fails. The workflow does not deploy Pages, test a browser wallet or independently authenticate canonical chain inclusion.

The same actual acceptance path passed locally on 3 November 2026: 17 transactions confirmed `SucceedEntirely` by the configured local indexer, 16 completed proof transactions, five matching ballot receipts and final tally `[2,1,2]` at block 100. Four invalid operations were rejected before proof/submission. The [public report](../evidence/2026-11-03/public/devnet-network-evidence.json) retains the contract address, configuration digest, all public transaction IDs, exact versions and source hashes. A clean isolated-graph `npm ci --ignore-scripts` and all 20 generated-runtime cases passed afterward. Local services were stopped after verification; this local result is not a hosted GitHub workflow result or a browser-wallet test.

## Publication gates and evidence

The Pages workflow always compiles and tests the generated native election, runs the native example, builds the static site, bundles the real native runtime/WASM and network client, and runs the actual Chromium acceptance scripts. The former legacy-only opt-out has been removed. A compiler, runtime, test, bundle, browser or packaging failure prevents deployment. The native manifest is checked, never modified by CI.

The build uses Bash's GitHub Actions failure handling (`-e -o pipefail`), so a command piped to `tee` cannot succeed merely because log writing succeeds. Evidence artifacts retain tool versions, the installed dependency tree, the reviewed lockfile, compiler/test/build logs, the native build manifest and the public synthetic-election snapshot for 30 days. They deliberately exclude private contexts, proof witness data, wallet data and generated compiler directories. Logs come only from the public compiler/build tasks and synthetic test fixtures. They are not suitable for logging real voter input.

The separate **Midnight contract compatibility** workflow additionally compiles/tests the retained admission starter and runs `contracts/native/prove-local.mjs` against proof server 8.1.3, pinned to image digest `sha256:0f4ab0716985eaebbe55a970348f52ff05ffd8a96631ed7232bd0c4ba02c115c`. It binds the server to loopback, uses one proving worker, does not enable verbose request logging and stops the container afterward. The proof smoke requests eight actual proofs covering all seven circuit types, checks that mismatched preimage/circuit material is rejected by the prover, and checks native rejection of an incorrect trustee share. Public proof hashes, byte counts and timings are retained; preimages and private contexts are not. Both workflows use full compilation, including generated circuit/key assets; key generation alone is not proof generation.

Passing the build/browser stages establishes generated-contract execution and real local Chromium execution. The native browser tests cover all trustee pairs, QR decoding, public exports, root/subdirectory hosting and failure handling. Network browser tests cover real SDK initialization and unavailable-wallet/error paths. The separate successful local proof stage establishes circuit proof generation. These stages do not establish wallet integration success, accepted transactions, independent proof verification, authenticated election-state verification or successful Pages deployment. Those need their own recorded outcomes, including a check at the eventual Pages project URL.

Fresh local execution on 3 November 2026 produced eight proof responses across all seven circuit types and passed both negative checks. This evidence is separate from GitHub execution, which still requires authenticated access to the selected repository. The proof client uses the official provider's fixed retry behavior; version 4.1.1 offers no public option to disable its three retries on HTTP 500/503.

## Deployment boundaries

Pull requests and manual runs on nonrelease branches cannot deploy. Only a successful build on `main` or `master` reaches the `github-pages` environment with `pages: write` and `id-token: write`. Environment protections may require repository-owner action. Pages hosts the frontend only; it does not deploy a Midnight contract or supply a prover, indexer or node. ChatGPT Sites is not involved.

GitHub Pages ignores the build's `_headers` file. Page metadata can enforce a content security policy, but this does not set server-only response headers. Check the deployed response and browser behavior separately.

## Checked official references

- [Midnight compatibility matrix](https://docs.midnight.network/relnotes/support-matrix): supplied devtools 0.5.1, compiler 0.31.1, runtime 0.16.0, on-chain runtime 3.0.0 and Midnight.js 4.1.1 remain the documented ledger-8 set. Newer compiler 0.34/0.35 releases target ledger 9 and are not compatible with these networks.
- [Official Compact devtools 0.5.1 release assets](https://github.com/midnightntwrk/compact/releases/expanded_assets/compact-v0.5.1): installer SHA-256 `85e74a53ae4a67b31fa4d854f3b6ffb4c29f7c53e3372c5008b6a4729a8b4a73`.
- [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages): artifact upload, deploy permissions, environment and build dependency.
- [Setup Node](https://github.com/actions/setup-node) and [Setup Python](https://github.com/actions/setup-python): the existing v7 action references are real supported releases.
