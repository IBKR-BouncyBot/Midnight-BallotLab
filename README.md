# Midnight Ballot Lab

![Midnight Ballot Lab — encrypted votes, shared results](docs/assets/ballot-lab-banner.svg)

**Cast your vote. Keep a receipt. Check the results.**

Explore encrypted voting with Midnight. Create an election, add your choices and keep a receipt for each vote. Reveal the totals with two of three trustees, then check the shared election record—even in a new browser session.

### [Open the app →](https://ibkr-bouncybot.github.io/Midnight-BallotLab/)

The homepage explains the lab and offers two ways to try it:

| Choose a mode | What it does | What you need |
| --- | --- | --- |
| [**Browser demo**](https://ibkr-bouncybot.github.io/Midnight-BallotLab/native.html) | Run real Midnight cryptography locally with **2–5 choices** and **1–1,024 demo voters**. All voters and trustees share one browser. No proofs or blockchain transactions are created. | A browser. No wallet or funds. |
| [**Public testnet**](https://ibkr-bouncybot.github.io/Midnight-BallotLab/network.html) | Connect to public Preview and use the wallet, prover and network transaction flow. Public Preview wallet connection has been tested; accepted application transactions on Preview remain unverified. | Midnight-enabled Lace on Preview; test NIGHT, usable tDUST and local proof server **8.1.3** for transactions. |

Anyone with the browser demo's shared election file can check that its record and totals agree. Each voter can also upload their own receipt to check that it appears in that record. These checks do not establish that the record is authentic or that the election was fair.

## Try an election in a few clicks

Open **Browser demo**, then:

1. **Set up election.** Add a name and your choices, then choose how many demo voters can take part. Pick manual controls or **Timed election**.
2. **Vote / Cast a ballot.** Choose a voter, click a choice and cast the ballot. Save the receipt as a QR code or file.
3. **Reveal results.** Select any two trustee cards to reveal the totals. A timed election closes and reveals automatically; keep the tab open.
4. **Verify election.** Upload the shared election file. Under **Check your own receipt**, upload a receipt file (JSON or text), or paste its contents. You can do this in a new session without setting up an election.

![Set up election, cast a ballot, reveal results and check the shared record](docs/assets/how-it-works.svg)

## What makes it interesting?

| Feature | What you can explore |
| --- | --- |
| **Encrypted votes** | Midnight encrypts each vote. The shared record contains encrypted ballots, without a list of who chose what. |
| **Your own choices** | Add 2–5 choices with your own labels and up to 1,024 demo voters. |
| **One vote per demo voter** | A voter cannot cast twice in the same election. Demo voters do not establish anyone's real identity or eligibility. |
| **Timed election** | Set a countdown from 15 seconds to 60 minutes, or use manual controls to explore each step. |
| **Two trustees reveal the result** | Any two of the three trustees can help reveal the combined totals. |
| **A receipt you can keep** | Save a QR code or receipt file. It identifies the encrypted ballot and election without including the choice. |
| **Check it yourself** | Upload the election file, check that its record and totals agree, then compare your receipt. No original session is needed. |

![Any two of three trustees help reveal the combined result](docs/assets/threshold-tally.svg)

## From a browser experiment to a test network

The [browser demo](https://ibkr-bouncybot.github.io/Midnight-BallotLab/native.html) executes generated Compact contract code and official Midnight WebAssembly locally. The [public testnet client](https://ibkr-bouncybot.github.io/Midnight-BallotLab/network.html) opens with **public Preview** and its official indexer addresses selected. No API key or local node/indexer is needed. Loading the page makes no public-network request; **Check public Preview services** runs read-only checks when you choose it, and connecting a Preview wallet repeats those checks before wallet access. Connection settings stay locked until you disconnect.

To continue, set up Midnight in Lace on Preview, get free test NIGHT from the [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/) and complete its CAPTCHA, select **Generate tDUST** in Lace, then run the [local proof server](https://docs.midnight.network/guides/run-proof-server) **8.1.3** on port 6300. [Real browser checks reached the public services](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/blob/main/evidence/2026-11-04/public-preview/browser-services.json), and [Lace 2.5.0 connected to Preview](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/blob/main/evidence/2026-11-04/public-preview/lace-connection.json) using a fresh, unfunded test wallet and a locally served app. That connection generated no proof and neither signed nor submitted a transaction. Public transaction testing still needs a funded wallet, usable DUST and the local prover; the GitHub Pages origin remains untested for wallet connection. Preprod is an advanced option requiring your own service access. The [network guide](docs/NATIVE_NETWORK.md#public-preview-setup) explains the steps and limits.

These are separate milestones: **running cryptography**, **generating a proof**, and **having a transaction accepted by a network**. Version 0.6.1 passed real browser checks, eight standalone circuit proofs and a complete isolated test-network election with 17 accepted transactions through the Node wallet integration. Five votes produced totals of `[2, 1, 2]` for the three active choices. Its build, compatibility and test-network workflows all passed on GitHub. These results belong to the exact source revisions in the [execution report](docs/CONTINUATION_RESULTS.md) and [GitHub run evidence](docs/GITHUB_EXECUTION.md); changes receive fresh checks.

**Lace 2.5.0 also completed a real browser-wallet election on the local development chain.** The application obtained wallet approvals, generated proofs through the local prover and completed nine accepted transactions, including eight contract calls. One vote produced totals of `[0, 1]`; the receipt and QR were checked. This used a locally served copy of the deployed application. Wallet transactions from the GitHub Pages origin, Preview and Preprod remain untested. Other API-4 wallets are conditional candidates; Cardano-only wallets are unsupported. See [wallet requirements and the exact test evidence](docs/NATIVE_NETWORK.md#wallet-compatibility).

The test-network run also demonstrated automatic results: an external operator waited for the real deadline, closed voting and submitted the two trustee contributions and final totals. It needs two test trustee secrets and running wallet, prover and network services. GitHub Pages does not run that operator.

GitHub Pages hosts the frontend. It does not supply a prover, run a Midnight node or deploy the contract. Hosting is independent of ChatGPT Sites.

## A hands-on research prototype

This lab helps explain and test encrypted voting; it is not a certified election system. One browser holds all demo voter and trustee secrets. The setup process knows the full decryption key, and two cooperating trustees could decrypt individual ballots outside the app. Real elections need separate identity, device, trustee and operational safeguards.

A successful check means **the supplied record agrees with its receipts and totals**. It does not prove that the election was fair. A made-up record can agree with itself, so confirm the election details through a source you trust and keep your own receipt. The export does not include proofs that establish voter eligibility, genuine trustee contributions or blockchain acceptance. The checks also cannot prove that a device recorded the intended choice, prevent coercion or guarantee that fraud is impossible. The [verification guide](docs/PUBLIC_VERIFICATION.md) and [security boundaries](docs/THREAT_MODEL.md) explain these limits.

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

## Buy me a coffee

If the lab has been useful, you can support IBKR-BouncyBot with a little NIGHT or ADA. It's completely optional.

**NIGHT or ADA · Cardano mainnet**

Scan the QR code or copy the address below. The [support section](https://ibkr-bouncybot.github.io/Midnight-BallotLab/#support) also has a copy button.

<img src="src/assets/support-ada-qr.svg" width="220" height="220" alt="QR code for the Cardano mainnet NIGHT or ADA support address">

```text
addr1q85w2v474ywzx868s69pghygek3vrhxm69e7c6ysuf28qhv8kmj5wd059grxl82f8h5mtyzl87cvqj8ldv2e0las7tnsdej9ax
```

## Noncommercial license

You can study, modify and share the project for noncommercial purposes under [PolyForm Noncommercial 1.0.0](LICENSE). Commercial use requires separate written permission from IBKR-BouncyBot. This restriction applies to project-owned material; [third-party components keep their own licenses](THIRD_PARTY_NOTICES.md).
