# Threat model and limits

## Demonstrated objective

Verify that a well-formed public transcript produces the reported tally under the fixed mathematical protocol and configured manifest. The reader can inspect the source and run the CLI without private keys. Ballot choices remain encrypted in the exported public record.

## Explicit assumptions

- The discrete-logarithm problem in the selected group is hard and SHA-256 behaves as required for the Fiat–Shamir constructions.
- CSPRNG output is unpredictable; devices and their random-number generators are not compromised.
- At least the required trustee secrecy assumptions hold outside the demonstration. Two colluding trustees in the 2-of-3 scheme can decrypt individual ballots. In this local demo, all trustee shares are held together by design.
- The verifier software and the election manifest hash used for comparison are authentic.
- The synthetic credential issuer enrolled the intended electorate and did not mint additional credentials. The demo proves authorization by listed pseudonymous keys, not that those keys correspond to unique eligible humans.

## Not provided

- National-election certification or independent security audit.
- Constant-time secret-key operations. JavaScript BigInt arithmetic is not a constant-time cryptographic library.
- Receipt-freeness or coercion resistance. A voter device can retain choices and encryption randomness; this implementation must not be described as preventing transferable proof of a vote.
- A cast-as-intended mechanism, such as a reviewed ballot challenge protocol or independent voter-verifiable paper record.
- Anonymous credential membership in the browser demonstrator. Public pseudonymous keys reveal participation to anyone who can link them to people.
- Distributed key generation: the demo dealer generates the trustees' shares in one process.
- Persistence, remote ballot collection, network resilience, censorship resistance, authentication of an official electoral register, or a public-chain connection.
- Long-term post-quantum ballot secrecy.

## What a valid result does not establish

A mathematically valid record can still be for a fabricated election with fabricated voter keys. It can omit submissions that never entered the accepted set. An internal manifest hash is not independent evidence of authenticity: an attacker can replace the manifest, generate new keys and create another internally consistent election. Use an expected hash established through an independent channel. A hash anchor also does not make the record available; all necessary public ciphertexts and proofs must be preserved.

Privacy excludes what the public result logically reveals. Unanimous totals and totals for tiny groups can identify choices even with perfect cryptography.

## Public and private data

Public: manifest, synthetic public credential keys, ballot ciphertexts and proofs, nullifiers, signatures, accepted ballot fingerprints, decryption shares and their proofs, aggregate, tally, verification report.

Private: voter credential signing secrets, plaintext choices, ballot randomness, trustee secret shares. These must not appear in public JSON exports, receipts, logs or the downloadable source bundle.

## Midnight integration boundary

The retained admission starter uses Midnight-specific membership logic. Version 0.3.0 adds a separate native encrypted-election source candidate; it has not been compiled, proved or deployed. See NATIVE_MIDNIGHT.md for its dealer, initialization, verifier-key and proving assumptions. It is not an adapter for the browser's finite-field protocol. The new native source defines constrained finalization, but its generated constraints and execution remain unverified; the browser demo does not invoke it. Do not enable finalization by replacing it with an administrator signature or a boolean assertion supplied by a caller.
