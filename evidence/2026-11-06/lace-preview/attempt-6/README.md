# Lace Preview attempt 6

[GitHub run 42296164699](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42296164699) executed commit `a84f2387a19722804525a76533f1c545d91a309d`. The exact [browser report](browser-report.json) records a fresh Midnight-only Lace 2.5.1 wallet and a genuine connection through the application using API `4.1.0-canary.20260819082604-3b622cb`.

The normal keyboard Save fallback closed the settings sheet automatically. After reopening, the in-process marker remained present, the local-host marker was absent, and neither control was hovered, focused or active. Thus this attempt completed the normal UI persistence check for “Run in this app (WASM).” This is a UI observation, not an API attestation or completed wallet-proof result.

The test correctly stopped before requesting funds at `wallet-current-vendor-services-required`. One normal vendor configuration response supplied the new Preview services, but the actual connected wallet API still reported the retired `blockfrost.lw.iog.io` indexer and RPC paths. The report preserves only origins, paths and query-key names; query values are absent. The report alone does not explain this configuration difference. The current-service guard was not relaxed.

No funds were requested or transferred, and the [public journal](public-journal.json) contains zero application operations. No DUST registration, contract proof or accepted application transaction is claimed. Fixed mode snapshots and blocked-request category counts are available in the report without raw console messages, URLs containing credentials, request bodies or private logs.

The separate [browser environment check](environment-initial.json) passed the initial headed Chromium launch with dependency validation enabled. Both dependency-repair steps were skipped. That check did not load Lace, prove anything or submit a transaction; the repair path was not exercised. Its [provenance](environment-provenance.json) and [hashes](environment-SHA256SUMS.json) are retained separately.

The [evidence artifact validation](evidence-artifact-validation.json) binds the GitHub archive digest to the unchanged browser report, journal and [official extension acquisition report](lace-acquisition.json). No profile, wallet keys, witness data, screenshots or traces were retained.

## Subsequent source review and unexecuted correction

Signed Lace source stores newly fetched flags as pending configuration, while Midnight reads the loaded configuration. Its normal activation waits until all extension views close before reloading. Keeping a wallet tab continuously open therefore prevents that activation path. The revised runner closes the ordinary extension views before wallet creation, observes old-worker closure, reopens the normal page and observes a distinct worker. It does not call `runtime.reload`, evaluate worker state or modify extension storage. Worker replacement alone is not treated as configuration attestation: visible node/indexer service labels must be current before Save, and the strict connector-service, HTTP/WS health and balance gates still precede funding.

[24 pure settings/service-label checks](settings-activation-check.json) and [36 request-policy checks](request-policy-recheck.json) passed against revised runner `67a3057ced6ad8e9c8447c31ae633f9759a8a586d10a2cd3d340b1e609a2ec3e`. Exact [settings](check-settings-activation.mjs.txt) and [policy](check-request-policy.mjs.txt) check harnesses are retained. These are Node predicate checks and source review, not a browser execution of the revised lifecycle or a new wallet/proof/transaction success. The original failed-run reports remain unchanged.
