# Check an election record independently

Every voter can import a public election JSON file in the browser demo's **Verify election**, including in a fresh browser session with no election or private credentials loaded. A QR or JSON receipt can then be compared with that record. This checks the consistency of the supplied public data. It does not authenticate an election or guarantee fairness.

The testnet page has its own **Upload a saved election record** control for downloaded `native-indexed-observation/v1` files. It uses the same native point, configuration, receipt, aggregate and threshold consistency checks, with a separate exact network schema. No wallet is required. The saved result appears separately from the live indexer record and does not change the connected election or enable voting. Its network and address are supplied labels, not authenticated chain evidence; an optional choice manifest is checked against the committed digest. Network receipt lookups still use the joined election's live indexer record. See [the network upload guide](NATIVE_NETWORK.md#upload-a-downloaded-network-record).

## For voters

1. Keep the receipt produced when you cast a ballot. It contains the election context, ballot index and receipt commitment, without the choice or credential secret.
2. Obtain the public election record and independently confirm the expected configuration digest. A file supplied by an untrusted party can describe an entirely different, internally consistent election.
3. Import the JSON file in **Verify election**. The verifier runs without the original private session and shows the active choices and finalized totals, if present.
4. Paste or import your receipt and compare it. A match means that this record contains the committed ciphertext at the receipt's position. It does not prove that a network accepted it or that a device encrypted your intended choice.

The private credential dropdown is only a way to choose a synthetic role in the current demonstration. Public snapshots contain no credential-to-ballot or credential-to-receipt mapping. Sharing a receipt can still correlate its public ballot with the person who shares it.

Downloaded receipt filenames use the requested local voter number to help keep files together. That label stays out of receipt contents, QR data and public election records; it is not an authenticated voter identity. In the testnet demo it follows the original numbered voter-key filename, and in the browser demo it follows the selected demo voter.

## Checks performed

[`verify-public.mjs`](../contracts/native/verify-public.mjs) uses the actual generated Compact pure circuits and official Midnight WASM. It does not use the original emulator ledger, voter secrets, trustee secrets, a wallet or a replacement elliptic-curve implementation.

| Check | Scope |
| --- | --- |
| Strict JSON and schema | Rejects duplicate keys, ambiguous numbers, unknown/private fields, wrong types, malformed arrays and records outside the 1,024-ballot / 2–5-choice bounds. |
| Native points | Requires canonical coordinates, native WASM decoding, exact coordinate round-trip and a native subgroup-order equation. Required public keys and ballot masks cannot be the identity. |
| Manifest and configuration | Recomputes the canonical metadata hash and Compact configuration digest, including candidate count, deadlines and public key commitments. Checks all three registered public-share relations. |
| Ballots and receipts | Recomputes every ciphertext receipt and checks ordered positions, distinct ballot masks and unique nullifiers/receipts. |
| Aggregate | Re-adds every ciphertext lane using generated native arithmetic and compares the published aggregate. |
| Finalized tally | Checks bounded totals, zero inactive lanes, the accepted-ballot sum and the threshold equation for every pair of published trustee contributions. |
| Voter receipt | Matches its election, configuration, address, index and commitment to the imported record. |

The implementation validates imported points **before** calling generated arithmetic helpers. `constructJubjubPoint` alone is not a point validator. The pinned native decoder and an explicit `[q−1]P + P = identity` check handle the curve/subgroup boundary. Malformed records produce a fixed stage error without echoing their contents.

## What a successful check does not prove

The public snapshot includes no ballot eligibility proof, ciphertext well-formedness proof or authenticated trustee-share proof. The verifier therefore cannot establish that every ciphertext encoded an allowed choice or that the supplied contributions came from the registered secret shares. Native contract execution enforces those relations; a copied JSON record does not carry evidence of that execution.

An attacker can construct a self-consistent replacement record, including substituted contributions and totals. The test suite demonstrates this explicitly: consistency passes while proof verification, eligibility, contribution authentication, chain inclusion and fairness remain false. Comparing a configuration digest and your receipt gives a useful external reference; it does not fill all those gaps.

Honest enrollment, unique human eligibility, omission resistance, device integrity, cast-as-intended voting, canonical chain inclusion and election fairness remain outside this check. Do not describe a successful import as a certified, fraud-proof or independently authenticated election.

## Timing and record format

The public schema is `midnight-ballot-lab/native-emulator-public/v2`. Its manifest binds the displayed choice labels, synthetic voter count and timing mode. Manual mode uses a 600-second simulated voting window. Scheduled local preview uses a real-clock duration of 15–3,600 seconds, while all roles and trustee secrets remain in the same browser session. Neither mode submits network transactions.

Five ciphertext lanes and five finalized totals are always present; only the configured 2–5 choices are active. The receipt schema remains `midnight-ballot-lab/native-emulator-receipt/v1`; its configuration digest binds it to the v2 election. The proof and chain-authentication flags remain false for these exports.

Run the dedicated tests after real native compilation:

```sh
node --test contracts/native/test/public-verifier.test.mjs
```

See [the execution report](CONTINUATION_RESULTS.md) for completed checks tied to source revisions and [the security model](THREAT_MODEL.md) for broader assumptions.
