# Midnight Ballot Lab

![Midnight Ballot Lab — encrypted votes, shared results](docs/assets/ballot-lab-banner.svg)

**Cast your vote. Keep a receipt. Check the results.**

Create an election, add your choices and try voting with real Midnight encryption. Keep a receipt for each vote, reveal the totals with two of three trustees, and check the shared election record—even in a new browser session.

### [Open the app →](https://ibkr-bouncybot.github.io/Midnight-BallotLab/)

Choose **2–5 choices** and **1–1,024 demo voters**. The main app is a local demonstration: all voters and trustees share one browser, and no wallet or funds are needed. It does not send votes to a blockchain.

## Try an election in a few clicks

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

The main app executes generated Compact contract code and official Midnight WebAssembly locally. A separate [development network client](https://ibkr-bouncybot.github.io/Midnight-BallotLab/network.html) connects the real Midnight.js wallet, prover, indexer and transaction providers. It requires a compatible wallet, configured test services and a local prover.

These are separate milestones: **running cryptography**, **generating a proof**, and **having a transaction accepted by a network**. Version 0.6.1 passed real browser checks, eight standalone circuit proofs and a complete isolated test-network election with 17 accepted transactions. Five votes produced totals of `[2, 1, 2]` for the three active choices. Its build, compatibility and test-network workflows all passed on GitHub. These results belong to the exact source revisions in the [execution report](docs/CONTINUATION_RESULTS.md) and [GitHub run evidence](docs/GITHUB_EXECUTION.md); changes receive fresh checks. Network transactions used the Node wallet integration. Browser-wallet transactions still need validation.

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
