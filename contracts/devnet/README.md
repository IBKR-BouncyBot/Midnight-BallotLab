# Isolated local network acceptance

This package exercises the existing generated Compact contract and SDK client on an explicitly selected fresh local `undeployed` chain. It is separate from the browser dependency graph. It does not connect to Preview, Preprod or mainnet. No public-network funds or user wallet credentials are required.

Read [the native network guide](../../docs/NATIVE_NETWORK.md) before starting the reviewed loopback node/indexer services and local prover. The public readiness probe is separate from contract acceptance:

```sh
node contracts/devnet/probe.mjs
npm --prefix contracts/devnet ci --ignore-scripts
npm --prefix contracts/devnet run test:runtime
node contracts/devnet/run-election.mjs --isolated-local-devnet
```

Generate the real contract assets with the main contract build first. `stage-runtime.mjs` copies byte-identical application files and generated bindings into `.runtime/`, so their imports resolve the isolated installed dependency graph. No substitute contract or mocked provider is used. The lockfile follows the maintained official example wallet graph: SDK/testkit 4.1.1, wallet SDK 1.2.0, compact-runtime 0.16.0, ledger 8.1.2, onchain runtime 3.1.1 and ZKIR 2.1.1. The ordinary application/browser lockfile retains its separately tested versions.

The runner reads an installed official genesis development fixture directly into memory. It rejects external seed environment variables. Both wallet/testkit loggers are silent before fixture access; library console output is suppressed and only its count retained. No seed, credential, individual selection, randomness, trustee share, proof witness, raw transaction or raw exception is logged. Transient SDK data is encrypted with a fresh in-memory password in a temporary directory, which the runner removes during cleanup. The local genesis wallet is not a production identity.

Allow approximately eight to ten minutes after wallet synchronization. The election opens four minutes after setup begins and closes four minutes later. The runner waits for actual indexed and wall-clock time. It deploys, configures the keys, enrolls five synthetic members, opens, casts five ballots, closes, submits trustee contributions 1 and 3, and finalizes. Every counted acceptance requires the configured indexer to report `SucceedEntirely`. Receipt and final-tally comparisons use the actual generated contract's public state. Negative tests separately establish that invalid selections, duplicate credentials, a wrong trustee share and changed totals are rejected before proving/submission.

Public evidence is written incrementally to `artifacts/local-devnet/network-evidence.json`, including dependency/source hashes, transaction IDs, heights and explicit confirmation limits. A failed or interrupted submission may have an uncertain outcome; inspect the recorded public transaction status before another attempt. The runner does not automatically retry a submitted election operation. Its final replay attempt reports only the observed submission-pipeline result, without inventing an independent chain-rejection claim.

The `ws` dependency is pinned to 8.22.1 after the initial audit identified vulnerable 8.20.0. The remaining eight moderate audit findings are in testkit's transitive container/archive dependency graph. This runner does not call those helpers, but they remain installed; no incompatible major override was applied to hide the findings. The separately installed browser/application graph has its own audit result.

A successful run establishes acceptance on this local chain through its configured indexer. It does not validate a browser extension connection, a public-network deployment, independent chain inclusion or election certification. GitHub Pages hosts the static frontend and provides none of the local services.
