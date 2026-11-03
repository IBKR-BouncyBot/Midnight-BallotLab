# Real Lace wallet verification

Executed on 3 November 2026 with the official, unmodified Lace 2.5.0 extension in an isolated Chromium profile. The extension package passed its developer and Chrome Web Store signature checks. Only the existing isolated `undeployed` chain and synthetic test funds were used.

## Completed application flow

The [durable browser run](attempt-2/browser-election.json) passed all nine application transactions: deployment, trustee key configuration, voter enrollment, opening, one encrypted ballot, closing, trustee contributions 1 and 3, and finalization. Eight of these were Compact contract calls requiring proofs; deployment is recorded separately. The final state was phase 3 with one accepted ballot and aggregate totals `[0, 1, 0, 0, 0]`.

Every transaction used the actual application controls and Lace approval/password screens. A [separate read-only SDK query](attempt-2/browser-transaction-confirmations.json) confirmed `SucceedEntirely` and the recorded block height for all nine transaction IDs. Both checks rely on the same configured local indexer; they do not independently verify consensus or canonical chain inclusion.

The runner observed 33 successful local prover HTTP responses across `/prove` and `/check`. These include wallet fee work and are not a count of contract proofs. No request bodies, witnesses, serialized transactions, private keys, passwords, individual selections or recovery phrases were retained.

The ballot's receipt matched the native indexed record, the rendered QR decoded to the exact receipt, and the [downloaded public record](attempt-2/public-indexed-observation.json) passed explicit field allowlists. The [receipt](attempt-2/public-receipt.json) and [QR](attempt-2/public-receipt-qr.png) are public. Their checks do not establish cast-as-intended assurance or election fairness.

The three [synthetic funding transactions](attempt-2/local-test-funding.json) used the Node wallet SDK and are separate from the nine browser-wallet application transactions.

## Versions and deployment boundary

| Component | Tested version |
| --- | --- |
| Lace / DApp Connector API | 2.5.0 / 4.0.1 |
| Node.js / Playwright / Chromium | 24.18.0 / 1.64.1 / 156.0.8078.4 |
| Compact compiler / runtime | 0.31.1 / 0.16.0 |
| Midnight.js | 4.1.1 |
| Local node / indexer / prover | 1.0.400 / 4.3.5 / 8.1.3 |

The tested application source was commit `f510608ece6b34b3206b3a1b99f05806ed248d95`. A [byte comparison](deployment-byte-comparison.json) found all 27 checked network HTML, loader, bundle, WASM and circuit files identical to the artifact deployed by [Pages run 41714965017](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/41714965017). Browser-wallet execution used a local HTTP origin. It did not exercise extension permissions, browser local-network access or transactions from the hosted GitHub Pages origin. Preview, Preprod and mainnet transactions were not tested; the application rejects mainnet.

The [package verification](package-verification.json) retains the official archive hashes. The [exact runner source](attempt-2/runner.mjs.txt) and [funding runner source](attempt-2/funding-runner.mjs.txt) are retained as audit text, with their hashes in the reports. They contain task-local setup paths and are not an installed wallet or a turnkey CI service. No wallet profile or secret checkpoint is included.

## Earlier interrupted attempt

The [first attempt](attempt-1/browser-election.json) recorded four accepted operations before its interactive test harness timed out after approving the ballot. A [read-only public check](attempt-1/interrupted-public-check.json) subsequently confirmed the ballot as `SucceedEntirely` at block 350. It was not resubmitted. The browser process and its private in-memory test state had ended, so that election was not tallied. Its reports remain separate from the completed run above.

The second run used a fresh wallet and election in a durable process. Windows required short temporary paths for the extension and browser profile; longer paths prevented Lace storage initialization. Neither fix changed wallet/application code, contract validation, network time or transaction outcomes.

Lace is the only browser wallet verified in this run. Other Midnight API-4 wallets remain conditional candidates. A local prover, matching indexer and usable test DUST are required. GitHub Pages supplies only the frontend.
