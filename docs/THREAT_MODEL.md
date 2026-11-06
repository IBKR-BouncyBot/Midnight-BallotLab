# Security assumptions and limits

See [current verification status](VERIFICATION_STATUS.md) for completed runs, the latest Preview browser-wallet result, exact versions and remaining limits. Historical results below remain tied to their recorded revisions.

Midnight Ballot Lab encrypts ballots with 2–5 active choices using native Jubjub operations and constrains their aggregation and two-of-three trustee tally in Compact. Five ciphertext lanes are always present; inactive totals must be zero. Its generated runtime, standalone circuit proofs and development-network transactions have separate evidence. A successful execution is not an independent security audit.

## Trust assumptions

- Devices and their cryptographically secure random-number generators must remain trustworthy. Scalar bounds and distinctness checks cannot prove that randomness is unpredictable.
- Voter credentials must be issued to the intended electorate. Membership proves possession of an enrolled secret; it does not establish that credentials correspond to unique eligible humans.
- The application, generated contract, verifier keys and expected configuration digest must be authentic.
- The browser contract prover receives private witnesses in its dedicated worker and has no HTTP fallback. Lace holds separate wallet/DUST witnesses; select **Run in this app (WASM)**. API 4 cannot attest that mode because on-device and delegated TEE modes both omit the prover URI. Rejecting reported server URIs does not prove all wallet processing stayed on-device. Developer CLI/devnet tools that use an HTTP prover remain a separate trust boundary.
- Trustees must protect their shares. Two colluding trustees can decrypt individual ciphertexts outside the contract's aggregate-only interface.

The demonstration uses a central dealer that knows the complete decryption key. All synthetic roles share one browser tab. Separate trustee custody and independently reviewed distributed key generation are required for meaningful organizational separation.

## Public checks

Receipts bind the election configuration and exact ciphertext. Anyone can import a public snapshot in a fresh session and recompute its native point, configuration, receipt, aggregate and threshold-equation checks without secret state. A copied snapshot does not authenticate an external election or establish proof generation, canonical chain inclusion, honest initialization or maintenance history.

The snapshot contains no ballot eligibility/ciphertext proof or authenticated trustee-share proof. A self-consistent replacement record, including substituted contributions and totals, can pass these checks. The test suite demonstrates this limit. Compare the expected configuration and voter receipt through an independently trusted channel, and describe the result as public-record consistency rather than fairness. [PUBLIC_VERIFICATION.md](PUBLIC_VERIFICATION.md) explains the exact checks and omissions.

Network confirmation comes from the configured indexer. Independently authenticating initial state, accepted chain state, circuit provenance, verifier keys, key setup and maintenance authority remains separate work. A reported transaction hash alone is not acceptance.

The tally reveals information by design. Unanimous totals or totals for small groups can reveal individual choices even if the cryptography operates correctly.

## Data handling

Public records contain only allowlisted election metadata, configuration digest, public keys, ciphertexts, nullifiers, receipt commitments, aggregates, trustee contributions and tally. Public network evidence contains transaction identifiers and confirmed block heights.

The synthetic voter dropdown and its used-credential state remain private to the local session. Exports do not include a voter-to-ballot or voter-to-receipt mapping. A person who shares a receipt may still identify their ciphertext to its recipient.

Private choices, ballot randomness, voter credential secrets, trustee secrets, private contexts, proof preimages and witness data must never appear in public exports, receipts, logs or source bundles. JavaScript cannot promise secure memory erasure. Refreshing the local browser session discards its in-memory state; export public records before ending a demonstration.

Changing the testnet screen only changes which existing panel is visible. It preserves private fields and pending-operation state in the same tab; it is not a reset, disconnect or secure erase. Visiting **Vote**, **Reveal results** or **Verify election** does not grant authority, advance a contract phase or establish that an earlier operation succeeded. The action-specific checks remain mandatory.

Scheduled browser mode is a local preview: it uses real clock time and then closes and finalizes with two synthetic shares held in that same session. Tabs can be suspended or closed; this is not an availability guarantee. The isolated development-network operator requires running services and two externally supplied synthetic shares. Automation does not create independent trustee custody.

## Unsupported claims

The application does not provide election certification, an independent audit, a cast-as-intended protocol, receipt-freeness, coercion resistance, long-term post-quantum secrecy or fraud impossibility. It does not authenticate a national electoral register or provide availability, censorship-resistance or throughput guarantees.

Pages hosts the frontend and public proving assets. The local browser demo does not generate network proofs or submit ballots; the separate network page has a browser contract prover and wallet integration. See [current verification status](VERIFICATION_STATUS.md) for the executed wallet/network scopes and outstanding limits. Local development chains and their test resources are not public-network deployments or real funds.