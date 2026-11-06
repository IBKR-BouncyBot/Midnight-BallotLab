# Manual Lace Preview acceptance

`lace-preview-acceptance.yml` is a separate, manual workflow for the trusted `main` branch of `IBKR-BouncyBot/Midnight-BallotLab`. It is not a pull-request gate or a Pages deployment. Its intended result is a complete nine-operation election using the actual application, a disposable official Lace wallet and public Preview. Source checks are not proof that this workflow has completed successfully; inspect the exact run and its final public report.

Creating the wallet requires explicit approval of Lace 2.5.1 onboarding, including its [Terms and Conditions](https://www.lace.io/iohktermsandconditions.pdf) and [Privacy Policy](https://www.lace.io/lace-privacy-policy.pdf). The dispatch input defaults to false. Set it to true only after that approval is given. Acquisition pins the signed official extension version and archive/manifest hashes; version drift fails instead of silently changing the wallet.

The workflow compiles the real contract and builds its browser/WASM proving files, then starts one headed Chromium process under Xvfb. The same wallet profile remains alive throughout funding and the election. Its private profile and private diagnostic output stay under `RUNNER_TEMP`; neither is an artifact. Application proofs must use the actual browser worker, and the runner selects Lace's on-device WASM mode for wallet/DUST work. There is no HTTP-prover fallback. API 4 alone cannot attest the selected wallet proving mode.

## Funding handoff

1. Start a fresh manual run after the source/acquisition review and onboarding approval. The workflow rejects rerun attempts; it does not automatically repeat a transaction or funding operation.
2. Wait for artifact `lace-preview-funding-RUN_ID`. It contains only the public funding request and signed-extension acquisition report. The browser continues running while this artifact is uploaded.
3. Verify the artifact's repository, exact source commit and run ID before using it. The strict request binds those identifiers, a nonce, `networkId: preview`, the canonical unshielded Preview address and a maximum of `5000000000` atomic test units. It contains no wallet secret. The bridge validates the address with the installed official Midnight address codec.
4. Fund that exact disposable wallet once through a separately authorized test-fund transfer. Funding is not performed by this workflow, and sponsor SDK proofs are not evidence of browser proving. Never use mainnet or real funds.
5. Let the same process continue. It waits for a balance, uses the wallet's actual Generate tDUST controls, and performs the election through the application and wallet UI. A timeout or uncertain operation is a failure to investigate, not permission to retry.

The funding request must appear within 20 minutes of startup. Funding can wait up to 60 minutes; each wallet synchronization/DUST wait has a 45-minute limit. Each application operation has a 20-minute limit, the runner has a 180-minute overall limit, and the job has a 210-minute limit. The election opens 15 minutes after setup and closes 25 minutes later, using its sealed deadlines. Neither a timer nor the supervisor can open, close or finalize it without the real actions.

## Evidence and cleanup

The final artifact, `lace-preview-evidence-RUN_ID`, explicitly allows only the acquisition report, funding request, browser report, public transaction journal, and optional public receipt/indexed observation. No directory wildcard, wallet profile, private log, screenshot, trace or video is uploaded. The journal records an operation before its first initiating click and preserves uncertain outcomes.

While waiting, the supervisor reads only the atomically written public browser report. It prints changes in a fixed set of stage names, overall/DUST statuses and operation ordinals/statuses/phases. It validates the run, commit and Preview context, and never prints addresses, URLs, arbitrary report fields or the private runner log. Missing initial reports produce no line; invalid progress produces a fixed `unavailable` marker without interrupting a possibly funded operation. This progress display does not replace the strict terminal acceptance check.

Success requires process exit zero, a matching run/commit report with `status: passed`, and exactly nine operations marked `indexer-accepted`. This is configured-indexer confirmation, not independently authenticated consensus. The report must continue to distinguish browser proofs from funding, preserve zero retries, and leave hosted-origin testing and independent chain verification false. The app is served locally on the CI runner; the GitHub Pages origin is not requested.

Cleanup signals only the verified task-owned process group. The runner closes its browser and removes its private profile; the ephemeral CI environment supplies the final isolation boundary. A failed run retains any available public partial report without converting it into success.

## Executed attempts

The [first isolated run](../evidence/2026-11-06/lace-preview/attempt-1/README.md) created a genuine Lace 2.5.1 wallet, then timed out while selecting network/prover settings. It produced no funding request and executed no application transaction. The retained report is failure evidence, not a completed browser-wallet election.

The [second run](../evidence/2026-11-06/lace-preview/attempt-2/README.md) identified the timeout after Save in the proving settings: the sheet remained open. It also stopped before funding or application connection. Its control-level diagnostics do not establish a saved proving mode.

The [third run, 42285202601](../evidence/2026-11-06/lace-preview/attempt-3/README.md), verified the Midnight-only account selection and saved on-device WASM setting, connected genuine Lace 2.5.1/API 4.1.0-canary to the local application, and produced a public funding request. The separate sponsor transferred 5,000 test NIGHT successfully, but the browser did not record observing that funding. The run was deliberately cancelled at `waiting-for-authorized-test-funding`; its final public report records `runner-interrupted`, zero application operations, and no DUST generation. Do not retry the funding transfer or treat sponsor acceptance as browser-wallet acceptance.

The [public configuration policy review](../evidence/2026-11-06/lace-preview/policy-review/README.md) covers a narrow allowance for Lace's normal vendor service-configuration request and a wallet-endpoint check before funding. These source checks do not prove that wallet synchronization or a new complete election has succeeded. A separate read-only service diagnostic records host-specific endpoint responses without using a wallet or submitting transactions.

Pages run [42285171322](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42285171322) separately passed its compiler/runtime/browser and proof gates and deployed commit `d2f588937131059873b2575ac9f5a3c65ad70873`. Its [evidence](../evidence/2026-11-06/browser-wasm/github-42285171322/README.md) includes eight standalone proofs and one genuine bound SDK transaction proof, with no wallet or accepted Preview transaction claim.
