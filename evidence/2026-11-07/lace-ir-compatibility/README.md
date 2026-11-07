# Signed Lace parser compatibility — 7 November 2026

The [first parser result](signed-ir-parser-result.json) at 09:16:00.174 UTC used the actual signed Lace 2.5.1 JS glue and proving WASM in Node. The historical IR2 `openVoting` fixture parsed successfully; the current compiler's IR3 `openVoting` and `configureKeys` files did not. This prevents using that custom-contract fundless diagnostic as a ledger-9 acceptance gate through this Lace build.

The [second result](signed-dust-ir-parser-result.json) at 09:27:57.980 UTC added the official generation-10 `dust/spend.bzkir` fixture; it **parsed successfully**. Its SHA-256 is `d211cacb22391b9db60f945787d98c16d344cbb4790246132117084c080399c1`. The wrapper fetched this public file before invoking the isolated parser. The result's `networkRequest: false` describes the parser execution, not the preceding public-file GET.

Parsing does not produce a proof. Neither check created or connected a wallet, used funds, signed or submitted anything. The application's ZKIR 3.2.0 contract worker and Lace's own DUST proving material are separate; these findings do not establish a full wallet/DUST failure or success. Do not replace current contract files with historical fixtures or relax the acceptance gate.

[Official signed-package acquisition](acquisition.json), [source review](source-review.json), [exact runner and public fixture provenance](provenance.json), and [retained file digests](SHA256SUMS.json) preserve the scope. These are new checks; earlier diagnostic reports are unchanged.
