# Isolated Lace Preview test — second attempt

[Run 42283256725](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42283256725) tested commit `888ef89251bee78d89af0297b479c4effc260f61` with signed official Lace **2.5.1**, Playwright **1.64.1** and Chromium **156.0.8078.4**. Native checks, the browser build and extension acquisition passed.

The finer diagnostics locate the timeout after clicking Save in the proving settings. The settings sheet remained visible for the 45-second UI timeout. The radio's test-ID element did not expose either checked or selected ARIA state, so this report does not establish which proving mode was saved. No funding request, application connection or transaction occurred; no proof success is claimed.

The original public reports are preserved byte for byte and bound to the verified GitHub artifact by `provenance.json`. The diagnostics contain a fixed list of control names and boolean visibility/state checks, plus fixed network-block categories. No private logs, arbitrary UI text, request bodies, wallet profile, password or seed was collected.
