# Local development network preparation

Prepared from official source on 3 November 2026. The user has selected and authorized a fresh isolated local development network. The reviewed service configuration and launcher are now in `contracts/devnet/`; this document itself is not execution evidence. Native browser/runtime, proof generation, service readiness and accepted transactions remain separate evidence stages.

## Services and endpoints

The maintained [official example compose file](https://github.com/midnightntwrk/midnight-examples/blob/main/examples/hello-world/compose.yml) provides this three-service recipe:

| Component | Exact image | Local endpoint |
| --- | --- | --- |
| Node | `midnightntwrk/midnight-node:1.0.400` | `http://127.0.0.1:9944`, `ws://127.0.0.1:9944` |
| Indexer | `midnightntwrk/indexer-standalone:4.3.5` | `http://127.0.0.1:8088/api/v4/graphql`, `ws://127.0.0.1:8088/api/v4/graphql/ws` |
| Prover | `midnightntwrk/proof-server:8.1.3` | `http://127.0.0.1:6300` |

Use a dedicated Docker Compose project and bind published ports to loopback. The node uses `CFG_PRESET=dev` and the upstream development block beneficiary. The indexer uses network ID `undeployed`, both internal node URLs `ws://node:9944`, and the upstream local fixture configuration for its embedded storage/pub-sub/SPO services. Those fixture settings are for this isolated environment only. Wait for block 1 before starting the indexer: its SPO component can otherwise fail at genesis. The upstream indexer health indicator is `/var/run/indexer-standalone/running`.

The example enables verbose proving and full Rust backtraces. Omit those settings here; private witness material must not enter logs. Do not collect raw prover requests/responses or transaction objects. Avoid a port collision with an already-running proof-server: explicitly select either that verified compatible local service or the dedicated compose service.

The official [toolchain declaration](https://github.com/midnightntwrk/midnight-examples/blob/main/toolchain.json) confirms these service versions, SDK/testkit 4.1.1, wallet SDK 1.2.0, compiler 0.31.1, and the local endpoint paths. The example currently overrides ledger 8.1.2/onchain runtime 3.1.1/zkir 2.1.1. This repository currently resolves SDK protocol ledger 8.1.0/onchain runtime 3.0.0. Do not silently copy the example overrides into the already tested application: review any dependency change and rerun native and browser checks. Container availability and actual node/SDK interoperability still require execution.

The [compatibility matrix](https://docs.midnight.network/relnotes/support-matrix), updated 2 November 2026, explicitly pairs node 1.0.400 with SDK 4.1.1, onchain runtime 3.0.0, compact runtime 0.16.0 and wallet SDK 1.2.0 on ledger 8. Retain those application pins initially. An RPC runtime version response alone cannot demonstrate contract transaction compatibility; the accepted-transaction run must establish that.

## Reviewed service launcher

The local WSL Docker installation has no Compose command. `contracts/devnet/services.sh` therefore implements the reviewed node/indexer configuration using Docker CLI calls. It requires Bash, Docker and OpenSSL, pulls the exact images above, and generates ephemeral infrastructure passwords in memory. These are new local service credentials, not wallet credentials. Docker container metadata necessarily holds the service environment; do not export a complete `docker inspect` result.

From a Linux shell at the repository root:

```sh
bash -n contracts/devnet/services.sh
bash contracts/devnet/services.sh up
```

On this Windows machine, run the same script through `wsl --distribution Ubuntu-24.04 --user root --exec bash` followed by its absolute `/mnt/c/.../contracts/devnet/services.sh` path and `up`. The launcher does not install Docker or start its daemon. Keep the existing local proof-server 8.1.3 running separately.

The containers are named `midnight-ballot-lab-devnet-node` and `midnight-ballot-lab-devnet-indexer`; their dedicated bridge is `midnight-ballot-lab-devnet-isolated`. Docker 29 did not forward the published loopback ports when this network used `internal: true`, so the reviewed configuration uses an ordinary bridge. This allows outbound networking; the separate development chain is selected by `CFG_PRESET=dev` and network ID `undeployed`. Published RPC/indexer ports remain bound to `127.0.0.1`, and no P2P port is published. No node data volume is mounted. The launcher refuses existing resources instead of resetting or reusing a chain. It preserves failed containers for inspection and never deletes resources. Container log collection is disabled, and health output contains only fixed stage names, image identifiers and statuses.

After both services are healthy, run from the repository root using the existing Windows Node installation:

```sh
node contracts/devnet/probe.mjs
```

This public-only probe waits up to three minutes for a non-genesis node header, an indexed block and prover version 8.1.3. It records an allowlist of node version/runtime numbers, block heights, indexer timestamp and prover version in `artifacts/local-devnet-readiness.json`. It does not use a wallet, produce a proof or submit a transaction. Failures omit raw responses and exception objects. `bash contracts/devnet/services.sh status` reports container status without printing credentials.

`contracts/devnet/compose.yml` is an equivalent reviewed alternative for installations with Compose. Do not start it alongside the CLI launcher. Supply its four required `MIDNIGHT_DEVNET_*` infrastructure variables from fresh random values in the shell, without writing or printing them; never run `docker compose config` without `--quiet` because rendered configuration includes those values.

## Wallet and provider requirements

The official [wallet implementation](https://github.com/midnightntwrk/midnight-examples/blob/main/examples/hello-world/src/wallet.ts) supplies named genesis-funded development identities for `undeployed`. Use one only after local-devnet authorization, keep the value in process memory, and never copy it into source, environment dumps, browser bundles, CI artifacts or this document. A newly generated random wallet is not automatically funded. No external faucet or real funds are required for the published local genesis identity.

Build with `FluentWalletBuilder.forEnvironment(env).withSeed(...).buildWithoutStarting()`, wrap with `MidnightWalletProvider.withWallet(...)`, and call `start(false)`. Supply the shielded and dust key objects derived from the builder's returned seeds, plus its keystore. Set the exported testkit logger and the supplied logger to silent before wallet construction. Wait for all wallet components to synchronize, at least one available DUST coin, and positive DUST value at the indexer's latest block timestamp. Genesis DUST can initially be worth zero even when a coin is present.

The tagged [testkit package](https://github.com/midnightntwrk/midnight-js/blob/v4.1.1/testkit-js/testkit-js/package.json) depends on wallet SDK 1.1.0, whereas the maintained examples explicitly override it to 1.2.0. Resolve and inspect one consistent wallet/ledger dependency graph before adding a runner. This document is not an instruction to install both independent wallet versions.

Avoid `MidnightWalletProvider.build`: its [tagged implementation](https://github.com/midnightntwrk/midnight-js/blob/v4.1.1/testkit-js/testkit-js/src/wallet/midnight-wallet-provider.ts) logs the seed. The [builder's `withRandomSeed`](https://github.com/midnightntwrk/midnight-js/blob/v4.1.1/testkit-js/testkit-js/src/wallet/fluent-wallet-builder.ts) also logs it. Do not rely on merely avoiding application `console.log` calls.

Use the official providers shown in [the example provider factory](https://github.com/midnightntwrk/midnight-examples/blob/main/examples/hello-world/src/providers.ts): `NodeZkConfigProvider` pointing at the actual managed native-election directory, `httpClientProofProvider` pointing at the local prover, `indexerPublicDataProvider` with both local URLs, and encrypted `levelPrivateStateProvider`. The wallet instance supplies both `walletProvider` and `midnightProvider`. Generate the storage password in memory; use a unique ignored private-state directory. Pass these into this repository's `createNativeSdkClient`, with `setNetworkId('undeployed')`. Use an actual WebSocket implementation for the Node indexer connection.

## Proposed execution and evidence

After writing and reviewing a dedicated compose file, its service-start command is `docker compose -p midnight-ballot-lab-devnet -f <reviewed-compose-file> up -d --wait`. Record resolved image digests and health results. Do not reuse the archived `midnight-local-dev` deployment CLI or a ledger-9 example with these ledger-8 bindings.

A new Node acceptance runner should use the existing SDK client and generated contract, with only synthetic election inputs in memory. It should deploy, prove/configure keys, enroll, wait for the real opening time, open, cast, wait for the real deadline, close, submit two trustee contributions, and finalize. Do not advance a fake clock or bypass contract checks. Allow for actual proof and block latency when choosing the schedule. Verify the indexed accepted ciphertext/receipt set and expected tally, and require SDK-confirmed successful outcomes before counting accepted transactions.

Use fixed stage labels and a public allowlist for evidence: image/package versions, contract address, configuration digest, public transaction IDs, block heights, expected/observed counts, and the public receipt checks. Never serialize wallet state, private inputs, proof data, raw exceptions or secret-bearing provider objects. An interrupted submission has an uncertain outcome; query its public status before retrying.

A successful local run establishes transactions accepted on this isolated development chain, subject to the configured indexer's confirmation. It does not establish Preview/Preprod deployment, independent chain verification, production readiness, or a real browser-wallet connection. The browser's DApp Connector flow requires separate testing with an actual compatible wallet; do not replace it with a fake injected wallet to claim that milestone. GitHub Pages remains static frontend hosting and supplies none of these services.
