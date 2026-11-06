# Official Lace 2.5.1 acquisition and static review

The official [Chrome Web Store listing](https://chromewebstore.google.com/detail/lace/gafhhkghbfjjkeiendhlofajokpaflmk) listed Lace 2.5.1, updated November 6, 2026. The freshly downloaded CRX3 package passed developer and Google Web Store publisher signature checks, exact ZIP and manifest hash checks, extension-ID verification, and bounded extraction. The final acquisition script was executed successfully on November 6; `acquisition.json` retains its public output.

`scripts/ci-acquire-lace.mjs` downloads only from the fixed official Google endpoints, rejects archive/version drift, and extracts into a fresh child of `RUNNER_TEMP`. It emits internal runner paths through `GITHUB_OUTPUT`; those paths and the temporary directory are not publication artifacts. The archive, extracted extension and any future browser profile must remain outside source and public artifacts.

`static-review.json` records hashes of the signed source files used for review. The extension declares Midnight API `4.1.0-canary.20260819082604-3b622cb`. Its normal **Run in this app (WASM)** choice uses an offscreen document and dedicated worker. Versioned key-material providers distinguish ledger-v8 8.1.0 / material generation 9 from the V9 provider. Public circuit and SRS assets come from `srs.midnight.network` and are SHA-256 checked by the extension. This source review does not establish successful proof generation or network compatibility.

The in-process setting saves directly; the remote-provider disclosure does not apply to that mode. The connector does not attest the selected mode: `proverServerUri` can be absent for both in-process and TEE-delegated configurations. A future test must observe the normal setting, actual worker resources, and accepted transactions separately.

Onboarding's Create, Connect and Restore buttons imply agreement to the linked [Terms of Service](https://www.lace.io/iohktermsandconditions.pdf) and [Privacy Policy](https://www.lace.io/lace-privacy-policy.pdf). No agreement or onboarding action was performed in this review. The CI workflow requires separate explicit approval before that action.

No extension was loaded, no wallet was created or connected, and no proof or transaction was executed during this acquisition/static-review task. Earlier Lace 2.5.0 reports remain historical evidence for that different version.
