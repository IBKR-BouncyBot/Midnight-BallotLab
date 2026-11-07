# Later public-service probes — 7 November 2026

These read-only probes occurred **after** [Lace attempt 11](../attempt-11/README.md) failed its wallet-indexer preflight. They do not recover the original CI HTTP status: that run retained only `public-service-request-failed`.

At [09:46:38 UTC](public-services-1794044798273.json), Lace's published Preview indexer returned HTTP **500**, while its published node and the canonical Preview node/indexer returned **200**. At [09:47:43 UTC](public-services-1794044863278.json), the indexer comparison was repeated, including the signed wallet's HTTP transport headers: the published wallet indexer again returned **500**, and the canonical indexer returned **200** at block 5238. The first canonical block was 5226.

A [third probe at 09:51:51 UTC](public-services-1794045112036.json) again returned HTTP **500** for both wallet-indexer request variants and **200** for the canonical indexer at block 5280; both node endpoints returned **200**. This additional point-in-time observation is not a new CI or wallet execution.

The [transport source review](transport-source-review.json) records the actual signed client source hash and header/body shape. Its reference to the “CI request” describes the reproduced request shape, not a captured CI response. No complete browser-transport equivalence, global outage, exact original CI cause or fixed service is claimed.

Only safe service origins, paths, query-key names, finite HTTP/error categories and public block numbers are retained. Query values, response bodies, wallet profiles and private inputs are absent. No wallet was opened and no transaction was submitted. [Provenance](provenance.json) and [file digests](SHA256SUMS.json) bind the four immutable original JSON files.
