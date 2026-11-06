# Isolated Lace Preview test — first attempt

[Run 42281878588](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42281878588) tested commit `2cb957c07a46a2e896845f7682c07fee59e1b4e3` with the signed official Lace **2.5.1**, Playwright **1.64.1** and Chromium **156.0.8078.4**. Native compilation/tests, the browser build and extension acquisition passed.

The browser created a fresh test wallet, then timed out during the network/on-device proving settings stage. The initial stage label does not identify the individual control that timed out. No public funding request was produced, no wallet connected to the application, and no funding or application transaction occurred. No contract or wallet/DUST proof success is claimed.

The three original public reports are retained byte for byte. `provenance.json` binds their hashes to the digest-verified GitHub artifact. Private profiles, passwords, seeds, screenshots and raw logs were not collected. This failure remains separate from any later attempt; it does not establish whether trustee registration works through Lace.
