# Public record protocol, version 1

This document describes the local research demonstrator. It does not describe the uncompiled Compact contract, and its ciphertexts and proofs are not accepted by a Midnight node.

## Group and encoding

The implementation uses the 2048-bit MODP group 14 prime from RFC 3526, its prime-order subgroup with `q = (p-1)/2`, and generator `g = 2`. The group constants are cross-checked against OpenSSL in the test suite. Group elements must be nonzero, below p, and in the subgroup. Public keys and each ballot's first ciphertext component must be nonidentity. Scalars are between zero and q-1, with nonzero secrets and encryption randomness.

Integers are fixed-width, lowercase, 512-hex-character strings. This is deliberately uniform rather than compact. Candidate counts are between 2 and 5. The local demonstrator caps elections at 1,000 ballots; this is not a national-scale performance claim. The browser interface uses a much smaller synthetic electorate.

## Hash domains

Each SHA-256 transcript is UTF-8 encoding of the canonical JSON array:

`["midnight-ballot-lab-v1", domain, ...values]`

Canonical JSON sorts object keys and allows only plain JSON objects, arrays, strings, null, booleans and safe integers. Number -0, floating-point values and unsupported types are rejected. Hashes are 64 lowercase hex characters. Different hash domains separate election manifests, ballot IDs, credential nullifiers, signatures, ballot sets, final records and proof challenges.

Import transport is stricter than generic JSON: UTF-8 files must not contain duplicate object fields, a byte-order mark, fractional/exponent-form number spellings, negative zero or unsafe integers. Duplicate names are compared after decoding escapes. JavaScript's browser and CLI import paths scan before native parsing, reject malformed UTF-8 and cap container nesting at 64. These checks prevent ambiguous transport files from receiving different meanings in the JavaScript and Python verification tools; they do not change the protocol's hashes or cryptography. The browser file limit is 8 MiB; the CLI reads at most 64 MiB.

## Setup

A local dealer chooses nonzero x and a and forms a degree-one Shamir polynomial `f(i) = x + a*i mod q`. Three trustees receive f(1), f(2), f(3). Public commitments g^x and g^a bind the election key and the polynomial. Each trustee public share must equal `g^x * (g^a)^i mod p`. Two or three verified shares reconstruct a decryption; one does not.

This is a centralized demo key ceremony. The application operator possesses all shares. A real separated-trustee deployment requires a reviewed distributed key-generation protocol and other operational changes.

Each synthetic voter has a distinct Schnorr public key listed in the manifest. The manifest contains no human names or private keys. These are public pseudonyms, not anonymous credentials and not evidence of unique human eligibility.

## Ballot

For each candidate, the chosen candidate has bit 1 and every other candidate bit 0. Under election key y = g^x, the encrypted bit is `(A,B) = (g^r, y^r*g^bit)`. Each component uses fresh nonzero cryptographic randomness.

A disjunctive Chaum–Pedersen proof shows the encrypted value is either 0 or 1. A further equality-of-discrete-logarithms proof over the product of candidate ciphertexts proves the sum of selections is exactly 1. Each proof binds the election hash, voter pseudonym, nullifier and applicable ciphertext/candidate context.

The voter signs the complete ballot body using Schnorr. The ballot ID hashes that body and signature. The election-scoped nullifier hashes the manifest fingerprint and voter public key. Reusing a credential produces the same nullifier, and aggregation rejects it even when re-encryption produces a different ballot ID.

## Aggregate and decryption

Each candidate's aggregate is the component-wise product of all accepted ciphertexts. The accepted-set digest binds the election hash and the sorted list of ballot IDs. The verifier checks all ballots before recomputing this aggregate. Merely checking decryption proofs is insufficient.

Each trustee publishes `D_i = A_total ^ f(i)` for each candidate, together with a Chaum–Pedersen proof tying it to the registered public share. The proof context includes the complete aggregate, trustee index and candidate index. Shares from another election or ballot set cannot be substituted.

Verified decryption shares are combined using Lagrange interpolation at zero. Dividing B_total by the combined decryption yields g^count. A bounded discrete-log lookup recovers each count between zero and the accepted ballot count; all counts must sum to the ballot count. The published tally must match these recomputed values.

## Receipts and authority

The QR payload is `mbl1:<electionHash>:<ballotId>`. It contains no candidate choice, voter signing secret, encryption randomness or decryption key. Checking a receipt requires a valid final record and the exact ballot ID in that record.

A receipt binds one encrypted ballot to a manifest. It does not establish that the manifest is the real election, that the whole electorate is legitimate, or that the voting device encrypted the intended selection. Likewise, a mathematically valid public record can be fabricated from a new set of keys. Verifiers separately report whether expected manifest and final-record hashes were supplied by the caller; their real-world authority must be established elsewhere.

## Public record

The export contains the manifest and its fingerprint, all accepted signed encrypted ballots and validity proofs, their aggregate, two or three public decryption shares with proofs, and the published tally. Private signing keys, trustee secret shares, individual plaintext choices and encryption randomness are excluded.

Verification succeeds only if the complete public transcript satisfies the schema and equations. A result is neither a blockchain inclusion proof nor a certification of election legitimacy.
