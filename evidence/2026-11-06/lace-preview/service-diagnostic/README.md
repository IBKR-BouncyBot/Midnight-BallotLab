# Public Preview service diagnostic — 6 November 2026

[Read-only run 42291304775](https://github.com/IBKR-BouncyBot/Midnight-BallotLab/actions/runs/42291304775) executed at commit `621164df9882184e2227a1d50362198778615278` on a GitHub-hosted runner, from **20:47:37.313 to 20:47:38.093 UTC**. It sent one fixed public GraphQL block query to each of two known endpoints, without authentication or redirects.

The signed Lace build's default `https://blockfrost.lw.iog.io/midnight-preview/` returned **HTTP 410**. `https://indexer.preview.midnight.network/api/v4/graphql` returned **HTTP 200**, block **1629224**, with indexed timestamp **20:47:24 UTC**. The service-check step therefore failed; artifact upload succeeded. The unchanged [report](report.json) retains finite status, block/time, origin and source-hash fields; the [audit](audit.json) verifies its artifact digest and commit.

These results describe two endpoints from that CI host at that time. They do not establish which endpoint a dynamically configured wallet used, explain the wallet wait by themselves, or validate wallet synchronization. No wallet, proof, transaction, subscription or hosted-application request was performed. No response body, credential, private path or private wallet data is retained.
