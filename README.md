# Midnight Ballot Lab

![Midnight Ballot Lab — encrypted votes, shared results](docs/assets/ballot-lab-banner.svg)

**Choose privately. Keep a receipt. Reveal the total together.**

Midnight Ballot Lab makes encrypted voting something you can see and try. Cast a ballot, watch it become encrypted, save a QR receipt, and select two of three trustees to reveal the result. It runs real Midnight cryptography in your browser, with a Compact smart contract checking the rules.

### [Open the app →](https://ibkr-bouncybot.github.io/Midnight-BallotLab/)

The interactive browser lab needs no wallet or funds. It runs locally in your browser using five sample voter credentials. It does not send votes to a blockchain.

## Try an election in a few clicks

1. **Create an election.** The lab prepares its keys, three trustees and five sample voters.
2. **Click your choice.** Cast each ballot and keep its receipt as a QR code or JSON file.
3. **Pick two trustees.** Click any two trustee cards to unlock the combined tally.
4. **Explore the checks.** Check a receipt against the election record and export the public data.

![Five steps: prepare an election, encrypt a vote, keep a receipt, choose two trustees, reveal the tally](docs/assets/how-it-works.svg)

## What makes it interesting?

| Feature | What you can explore |
| --- | --- |
| **Encrypted ballots** | Choices are encoded and encrypted with Midnight's native cryptographic operations. The public record contains ciphertexts rather than plain choices. |
| **One vote per credential** | The contract checks membership and rejects reuse of the same credential in an election. A credential is not proof of a unique person. |
| **Two-of-three tallying** | Any two registered trustees can provide the contributions needed to reveal and check the combined result. |
| **QR receipts** | A receipt identifies an encrypted ballot and its election. Check it against the loaded record without putting the choice in the receipt. |
| **Visible checks** | Inspect receipt matching, ciphertext totals and trustee tally equations, with clear limits on what these checks establish. |

![Any two of three trustees can combine their contributions to reveal the aggregate tally](docs/assets/threshold-tally.svg)

## From a browser experiment to a test network

The main app executes generated Compact contract code and official Midnight WebAssembly locally. A separate [development network client](https://ibkr-bouncybot.github.io/Midnight-BallotLab/network.html) connects the real Midnight.js wallet, prover, indexer and transaction providers. It requires a compatible wallet, configured test services and a local prover.

These are separate milestones: **running cryptography**, **generating a proof**, and **having a transaction accepted by a network**. The project has recorded all three: browser/WASM execution, eight standalone circuit proofs, and a complete isolated devnet election with 17 accepted transactions and a `[2, 1, 2]` tally. The accepted transactions used the Node wallet integration; browser-wallet transactions still need validation. See the [execution report](docs/CONTINUATION_RESULTS.md) and [GitHub run evidence](docs/GITHUB_EXECUTION.md) for exact tested commits and versions.

GitHub Pages hosts the frontend. It does not supply a prover, run a Midnight node or deploy the contract. Hosting is independent of ChatGPT Sites.

## A hands-on research prototype

This lab helps explain and test the mechanics; it is not a certified election system. The browser demonstration holds voter and trustee roles together, and its key dealer knows every secret share. Two cooperating trustees could decrypt individual ballots outside the app. Real use would require separate security, identity, device and operational safeguards.

A receipt check confirms consistency with the loaded record. It does not independently prove blockchain inclusion or that a device recorded the intended choice. The lab makes no claim of coercion resistance or fraud impossibility. Read the [security boundaries](docs/THREAT_MODEL.md) before adapting it.

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
| [Automated checks](.github/workflows/) | Compilation, runtime tests, real browser checks, proving and devnet acceptance |

Private choices, randomness, credentials, secret shares and proof witnesses stay out of public exports and test logs. See the developer guides for prover handling and the remaining integration limits.
