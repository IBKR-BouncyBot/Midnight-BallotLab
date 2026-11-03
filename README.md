# Midnight Ballot Lab

![Midnight Ballot Lab — encrypted votes, shared results](docs/assets/ballot-lab-banner.svg)

**Choose privately. Keep a receipt. Reveal the total together.**

Midnight Ballot Lab makes encrypted voting something you can see and try. Give your election a name, add your choices, cast encrypted ballots and reveal the combined result with two of three trustees. Every voter can save a receipt and check the public election record in a fresh browser session. Real Midnight cryptography runs in your browser, with a Compact contract checking the rules.

### [Open the app →](https://ibkr-bouncybot.github.io/Midnight-BallotLab/)

The interactive lab needs no wallet or funds. Choose **2–5 candidates** and **1–1,024 synthetic voter credentials**. The main experience runs locally in your browser; the separate development-network client uses actual wallet, prover and network services.

## Try an election in a few clicks

1. **Set up election.** Name the election, enter 2–5 choices and select the number of synthetic voters. Choose manual controls or a timed local preview.
2. **Vote / Cast a ballot.** Choose an unused credential from the private session dropdown, click a choice and save its QR or JSON receipt.
3. **Reveal results.** In manual mode, select any two trustee cards. A scheduled local preview closes and reveals automatically after its chosen duration.
4. **Verify election.** Export the public record. Anyone can import it in a fresh session, recompute its public checks and compare their own receipt—without a private credential.

![Set up election, cast a ballot, reveal results and independently check the public record](docs/assets/how-it-works.svg)

## What makes it interesting?

| Feature | What you can explore |
| --- | --- |
| **Encrypted ballots** | Choices are encoded and encrypted with Midnight's native cryptographic operations. The public record contains ciphertexts rather than plain choices. |
| **Your election, your labels** | Configure 2–5 choices and 1–1,024 synthetic credentials. Five encrypted lanes keep the contract layout fixed; unused candidate totals must remain zero. |
| **One vote per credential** | The contract checks membership and rejects reuse of the same credential in an election. A credential is not proof of a unique person. |
| **Manual or timed preview** | Explore each step manually, or use a local countdown of 15–3,600 seconds. Timing does not create separate trustee custody or a hosted service. |
| **Two-of-three tallying** | Any two registered trustees can provide the contributions needed to reveal and check the combined result. |
| **QR receipts** | A receipt identifies an encrypted ballot and its election. Check it against the loaded record without putting the choice in the receipt. |
| **Independent public checks** | Import a public JSON record without the original session. Check native points, configuration, ballot commitments, aggregate ciphertexts and trustee tally equations, then compare a receipt. |

![Any two of three trustees can combine their contributions to reveal the aggregate tally](docs/assets/threshold-tally.svg)

## From a browser experiment to a test network

The main app executes generated Compact contract code and official Midnight WebAssembly locally. A separate [development network client](https://ibkr-bouncybot.github.io/Midnight-BallotLab/network.html) connects the real Midnight.js wallet, prover, indexer and transaction providers. It requires a compatible wallet, configured test services and a local prover.

These are separate milestones: **running cryptography**, **generating a proof**, and **having a transaction accepted by a network**. Recorded runs include browser/WASM execution, eight standalone circuit proofs and complete isolated devnet elections with 17 accepted transactions and a `[2, 1, 2]` tally. These results belong to the exact source revisions in the [execution report](docs/CONTINUATION_RESULTS.md) and [GitHub run evidence](docs/GITHUB_EXECUTION.md); changes receive fresh checks. Network transactions used the Node wallet integration. Browser-wallet transactions still need validation.

The development-network operator can schedule closing and finalization against actual node time. It requires two externally supplied synthetic trustee shares and running local services. The browser countdown is a separate local preview.

GitHub Pages hosts the frontend. It does not supply a prover, run a Midnight node or deploy the contract. Hosting is independent of ChatGPT Sites.

## A hands-on research prototype

This lab helps explain and test the mechanics; it is not a certified election system. The browser demonstration holds voter and trustee roles together, and its key dealer knows every secret share. Two cooperating trustees could decrypt individual ballots outside the app. Real use would require separate security, identity, device and operational safeguards.

A successful public check means the supplied record is **internally consistent**. Its export contains no authenticated ballot or trustee-share proofs, so a self-consistent replacement record can pass. Compare the election configuration and your receipt through an independently trusted channel. These checks do not establish eligibility, honest enrollment, blockchain inclusion, cast-as-intended voting or election fairness. The lab makes no claim of coercion resistance or fraud impossibility. Read the [verification guide](docs/PUBLIC_VERIFICATION.md) and [security boundaries](docs/THREAT_MODEL.md) before adapting it.

## Build, test and explore the source

The application uses Compact compiler **0.31.1**, compact-runtime **0.16.0**, Midnight.js **4.1.1** and proof-server **8.1.3**. Exact dependency graphs are pinned in npm-generated lockfiles. Follow the [native setup guide](docs/NATIVE_MIDNIGHT.md), [Windows instructions](docs/WINDOWS_NATIVE.md), [network guide](docs/NATIVE_NETWORK.md) or [GitHub Pages guide](docs/GITHUB_PAGES.md).

With the pinned Compact toolchain, Node 24 and Python installed:

```sh
npm --prefix contracts ci --ignore-scripts
npm --prefix contracts run compile
npm --prefix contracts run test:native
npm run demo
npm test
npm run build
npm --prefix contracts run build:browser:native
node scripts/build-network-browser.mjs
node contracts/node_modules/playwright/cli.js install chromium
node scripts/test-native-browser.mjs
node scripts/test-network-browser.mjs
python3 scripts/check_pages.py
python3 -m http.server 8080 --bind 127.0.0.1 --directory dist
```

Run both browser bundlers after each static build. The build only enables the app when real generated code and assets are present. Use `python` instead of `python3` on Windows if needed.

| Start here | Explore |
| --- | --- |
| [Compact contract](contracts/native-election.compact) | Eligibility, encryption, receipts, aggregation and tally constraints |
| [Native implementation](contracts/native/) | Generated-contract execution, private inputs and Midnight.js integration |
| [Browser application](src/native-app.mjs) | Clickable voting, trustee selection and public checks |
| [Independent public verifier](contracts/native/verify-public.mjs) | Strict imports, native point validation, commitments and tally consistency |
| [Automated checks](.github/workflows/) | Compilation, runtime tests, real browser checks, proving and devnet acceptance |

Private choices, randomness, credentials, secret shares and proof witnesses stay out of public exports and test logs. See the developer guides for prover handling and the remaining integration limits.

## Noncommercial license

You can study, modify and share the project for noncommercial purposes under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires separate written permission from IBKR-BouncyBot. This restriction applies to project-owned material; [third-party components keep their own licenses](THIRD_PARTY_NOTICES.md).
