# First browser attempt

The original browser report is retained unchanged. It timed out during worker initialization and generated no proof, opened no wallet and submitted no transaction.

The report's `proofServerRequests: prohibited-by-page-csp` label is inaccurate: a document's meta CSP does not constrain an ordinary same-origin worker. The worker implementation itself has no HTTP proof provider; its asset loader permits only same-origin public-file GETs with size and SHA-256 checks. The task-owned HTTP proof server was stopped before this test. None of those observations establishes proof completion.

The following attempt will use an explicit worker-startup handshake and separate factual fields for HTTP-provider configuration, public asset policy and the main document's CSP. Do not treat this failed run as successful browser proving.
