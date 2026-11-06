# Verification status

This is the current summary of what has been executed and what remains unverified. Dated reports retain their original scope; a later success does not rewrite an earlier failure.

## Current browser-wallet attempt

[Lace Preview run 42300599784](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42300599784), at commit `e22832c2424cf89c8756e3156e943b1f87021469`, finished on **6 November 2026 at 22:58:21 UTC**. Its [final report](../evidence/2026-11-06/lace-preview/attempt-9/browser-report.json) records **nine indexer-accepted application operations and eight completed application contract-proof calls**, with no transaction retry. The receipt and QR-payload comparison completed; phase 3 contains one ballot and five-lane totals `[1,0,0,0,0]`. Completion of the browser/native public-record check is inferred from the executed control flow reached before the failed gate; its later raw completion flag was not written.

**The overall workflow failed** its final `wallet-prover-WASM-resource-not-observed` gate. The observer recorded zero wallet-prover WASM resources. This does not establish that no wallet proof ran; it means the required resource evidence was not obtained. The original failure is retained, and no success flag or observation requirement was changed. Selecting and reopening the on-device WASM setting, usable wallet DUST, successful application proofs and accepted transactions do not independently attest Lace's wallet/DUST proof backend.

The [evidence notes](../evidence/2026-11-06/lace-preview/attempt-9/README.md) separate sponsor funding, DUST registration, application proofs and indexed acceptance. The application ran at a local origin on the CI host while connecting to **public Preview**; the hosted GitHub Pages origin was not tested. This result establishes the recorded application election, not complete browser-only wallet-proof verification.

A [separate fundless diagnostic](CI_LACE_PREVIEW.md#separate-fundless-wallet-prover-diagnostic) is prepared to investigate the missing resource observation through a genuine Lace contract-proof request. It has not yet run and will not register DUST or submit another election.

## Completed evidence

| Execution | What the retained result establishes |
| --- | --- |
| [Browser runtime and proof CI](../evidence/2026-11-06/browser-wasm/github-42299277893/README.md) | Real generated contract/WASM execution; eight standalone proofs across seven circuits; one genuine bound SDK `configureKeys` transaction proof; two rejected invalid cases. No wallet or network submission in this gate. |
| [Public Preview Node SDK election](../evidence/2026-11-06/public-preview-sdk/README.md) | Nine indexer-accepted election transactions and eight proved contract calls, final totals `[0,1,0,0,0]`. Separate Node wallet/HTTP-prover path; not a browser or Lace test. |
| [Local Lace election](../evidence/2026-11-03/lace-wallet/README.md) | Lace 2.5.0/API 4.0.1 completed nine application transactions on a local `undeployed` chain. This historical server-prover result does not establish the newer browser-only proving path. |
| [Local devnet acceptance](../evidence/2026-11-03/v0.6.1/github/devnet/reports/network-evidence.json) | Seventeen indexer-accepted transactions and an externally scheduled five-ballot tally. Separate Node wallet and local services. |
| [Pages publication](GITHUB_EXECUTION.md) | Commit `cf18b45` deployed successfully. The subsequent `e22832c` build/proof gates passed, but publication was cancelled at the ten-minute limit while `syncing_files`. Its runtime bytes match the preceding deployment. |

The local browser demo executes native cryptography but neither generates network proofs nor submits ballots. Public-record imports verify consistency using native WASM; they are not authenticated proof packages or independent chain verification.

## Tested versions and assets

The current browser application uses **Compact 0.31.1**, compact-runtime **0.16.0**, Midnight.js **4.1.1**, ledger-v8 **8.1.0**, onchain-runtime-v3 **3.0.0** and ZKIR **2.1.1**. The retained CI gate used Node **24.22.2**, npm **11.19.1**, Python **3.12.16**, Playwright **1.64.1** and Chromium **156.0.8078.4**. Attempt 9 uses signed Lace **2.5.1**, reporting API **4.1.0-canary.20260819082604-3b622cb**. The separate SDK/devnet dependency graphs retain their own versions.

The [exact asset audit](../evidence/2026-11-06/browser-wasm/github-42299277893/deployment-ci-evidence-audit.json) records native/network bundle, worker and manifest hashes, with 21 circuit assets, five pinned public parameter files and three network-bundle WASM files. No proof witnesses, private key files or wallet profile are included. The worker uses official WASM and verifies public asset hashes; there is no HTTP-prover fallback in the browser contract path.

## Limits

- **Wallet proving mode:** selecting and reopening Lace's **Run in this app (WASM)** setting is a UI observation. API 4 omits the prover URI for both on-device and delegated TEE modes, so an absent URI cannot attest the backend. Wallet resource observations must be reported separately from application-worker proofs.
- **Network confirmation:** acceptance means the configured indexer reported success. A second query to that indexer is not independent consensus or inclusion verification. No current hosted-origin wallet test or Preprod transaction result is claimed; mainnet is blocked and real funds are not authorized.
- **Recovery:** encrypted SDK storage does not make a complete election backup. Key-file round trips and failure boundaries are tested, but restoring a complete session in another browser and then completing an accepted transaction is not. Pending-ballot checks are session-bound; deployment before key configuration cannot yet be recovered through Join. See [recovery limits](NATIVE_NETWORK.md#save-and-load-administrator-or-voter-keys).
- **Election privacy and authenticity:** the demonstration dealer knows the decryption key, and two colluding trustees can decrypt individual ciphertexts. Small or unanimous totals can reveal choices. A consistent public record does not prove eligibility, authentic history or fairness. No certification, coercion resistance or fraud-impossibility claim is made.
