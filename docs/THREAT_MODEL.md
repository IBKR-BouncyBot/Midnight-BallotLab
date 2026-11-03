# Security assumptions and limits

Midnight Ballot Lab encrypts three-choice ballots using native Jubjub operations and constrains their aggregation and two-of-three trustee tally in Compact. Its generated runtime, standalone circuit proofs and development-network transactions have separate evidence. A successful execution is not an independent security audit.

## Trust assumptions

- Devices and their cryptographically secure random-number generators must remain trustworthy. Scalar bounds and distinctness checks cannot prove that randomness is unpredictable.
- Voter credentials must be issued to the intended electorate. Membership proves possession of an enrolled secret; it does not establish that credentials correspond to unique eligible humans.
- The application, generated contract, verifier keys and expected configuration digest must be authentic.
- The configured prover receives private witnesses and must be trusted. Keep proving local unless the privacy properties of another service have been explicitly addressed.
- Trustees must protect their shares. Two colluding trustees can decrypt individual ciphertexts outside the contract's aggregate-only interface.

The demonstration uses a central dealer that knows the complete decryption key. All synthetic roles share one browser tab. Separate trustee custody and independently reviewed distributed key generation are required for meaningful organizational separation.

## Public checks

Receipts bind the election configuration and exact ciphertext. Public checks can compare a receipt with the current runtime ledger and check internal consistency. A copied public snapshot does not authenticate an external election or establish proof generation, canonical chain inclusion, honest initialization or maintenance history.

Network confirmation comes from the configured indexer. Independently authenticating initial state, accepted chain state, circuit provenance, verifier keys, key setup and maintenance authority remains separate work. A reported transaction hash alone is not acceptance.

The tally reveals information by design. Unanimous totals or totals for small groups can reveal individual choices even if the cryptography operates correctly.

## Data handling

Public records contain only allowlisted election metadata, configuration digest, public keys, ciphertexts, nullifiers, receipt commitments, aggregates, trustee contributions and tally. Public network evidence contains transaction identifiers and confirmed block heights.

Private choices, ballot randomness, voter credential secrets, trustee secrets, private contexts, proof preimages and witness data must never appear in public exports, receipts, logs or source bundles. JavaScript cannot promise secure memory erasure. Refreshing the local browser session discards its in-memory state; export public records before ending a demonstration.

## Unsupported claims

The application does not provide election certification, an independent audit, a cast-as-intended protocol, receipt-freeness, coercion resistance, long-term post-quantum secrecy or fraud impossibility. It does not authenticate a national electoral register or provide availability, censorship-resistance or throughput guarantees.

Pages hosts the frontend only. The native browser session does not generate network proofs or submit ballots. The separate browser-wallet integration requires further transaction validation with an actual compatible wallet. Local development chains and their test resources are not public-network deployments or real funds.
