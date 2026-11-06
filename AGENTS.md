# Midnight Ballot Lab

## Product and repository

Midnight Ballot Lab is a native Midnight application with encrypted ballots, two-of-three trustee tallying, QR receipts and public checks. Use real generated Compact contracts, Midnight cryptography and browser WASM throughout. Keep the product focused on this application and its current user journey.

Source is hosted at `https://github.com/IBKR-BouncyBot/Midnight-BallotLab`; the frontend is served through ordinary GitHub Pages at `https://ibkr-bouncybot.github.io/Midnight-BallotLab/`. Read the owning source and fresh execution reports before making claims. Commit-specific test provenance is retained in Git history and `docs/GITHUB_EXECUTION.md`.

Use only the public owner alias `IBKR-BouncyBot` in notices, documentation and Git author metadata. Do not publish the owner's personal name, personal email or operating-system username. Redact personal filesystem prefixes from retained logs and downloadable archives; do not change their test results. See `docs/PRIVACY_REDACTION.md` for historical evidence handling.

## Evidence and workflow

- Native compilation, generated-runtime tests, browser/WASM checks, circuit proofs and isolated development-network acceptance have recorded passes. Read `docs/CONTINUATION_RESULTS.md` and exact retained evidence for stage boundaries and tested commits. Rerun affected checks after changes; do not infer compatibility from syntax or pins.
- Install the official toolchain first; verify the current support matrix and the intended network. Start with the recorded pins, changing them only as a consistent, documented set.
- Run the actual compiler, generated-contract tests and demo, fix demonstrated failures, then bundle and exercise the real browser/WASM path.
- Root `npm test` covers local JavaScript and adapter logic, not generated native contracts.
- Root `npm run build` clears `dist/` and disables both browser builds. Run `npm --prefix contracts run build:browser:native` and `node scripts/build-network-browser.mjs` afterward.
- Do not fabricate generated bindings, proof keys, native test results or a dependency lockfile. Review and commit a real lockfile after installation.
- Missing native prerequisites must remain failures. Never substitute mock cryptography or manually enable a success flag.
- Separate emulator success, proof generation, network acceptance, independent public verification and GitHub deployment in reports.
- Keep the Midnight styling and a clear native election experience. Describe user-facing behavior in plain language and keep implementation detail in developer documentation.
- Keep the network client's five screens separate from its contract phases. Navigation preserves the in-memory session, private fields, receipts and uploaded result, performs no network action and cannot bypass action-specific checks. Verify remains reachable without a wallet; existing heading/control hash links must reveal their owning screen.

## Contract boundaries to preserve

- Secret key setup belongs in the constrained `configureKeys` call, not unproved constructor private calculations.
- Keep canonical nonzero subgroup scalar checks. Jubjub subgroup arithmetic and Compact coordinate Field arithmetic use different moduli.
- Bind membership paths to voter secrets and the current frozen electorate root; enforce election nullifier uniqueness.
- Compute the full one-hot ciphertext inside the circuit. Do not accept opaque caller digests as ballot validation.
- Keep the sealed candidate count at 2–5, bind it into the configuration digest, preserve all five ciphertext lanes and require zero inactive totals.
- Bind receipts to the exact election/configuration/ciphertext and compare them with the locally constructed ballot.
- Aggregate the complete accepted ciphertext set. Trustee contribution calls must use the frozen aggregate, with no arbitrary subset parameter.
- Require valid registered trustee contributions and bounded totals satisfying the correct pair equations.
- Public exports must exclude choices, randomness, secrets, private contexts and proofData.
- Keep the synthetic credential selector and used-credential mapping private to the session; do not export a voter-to-ballot or voter-to-receipt mapping.
- At the user's request, receipt filenames follow the local voter/key-file number. Keep that convenience label out of receipt contents, QR payloads and public records; it is not a network voter ID. Any key-to-filename association stays in memory only.
- Validate imported coordinates with actual native WASM and subgroup checks before using generated pure helpers. Public import establishes supplied-record consistency only; missing ballot/share proofs prevent authentication and fairness claims.
- Keep manual/scheduled browser previews separate from the external local-devnet operator. Real network closing must use actual indexed/wall time, valid registered shares and accepted transactions; a timer cannot bypass contract checks.
- Authenticate initial state, contract code/verifier keys, key configuration, chain state and maintenance policy in the real integration. An indexer response alone is not independent chain verification.

## Scope and completion

Use a development/test environment for actual proving/network integration until a production deployment is explicitly requested. Do not store wallet seeds or secrets in source, browser bundles, Actions artifacts or documentation. The demo dealer is centralized and all browser demo roles share one process; preserve these disclosures.

Complete unblocked implementation and checks before requesting missing access details. The user selected `https://github.com/IBKR-BouncyBot/Midnight-BallotLab` and requested public Preview as the network page default. Use test funds only. The isolated local devnet remains available for development and CI; its accepted transactions are distinct from public Preview service and wallet-connection checks. Actual deployment/transaction evidence and any remaining access requirement are recorded in `docs/CONTINUATION_RESULTS.md`. Do not treat a local-devnet address as a public-network deployment.

Completion requires real compiler/runtime/browser evidence, a truthful native UI, reviewed CI, and a successful deployment to the selected GitHub Pages target. If real network integration is still blocked, document the exact remaining service/access requirement and do not call the emulator an on-chain election.

Avoid unrelated changes. Do not present this research prototype as suitable for national elections without a separate security and operational assurance process.
