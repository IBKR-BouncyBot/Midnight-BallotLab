#!/usr/bin/env bash
# Remove only this job's labeled, named local services. Never read raw logs or env.
set -euo pipefail
set +x
[[ "${GITHUB_ACTIONS:-}" == true ]] || { printf '%s\n' 'This cleanup is only for GitHub Actions.' >&2; exit 1; }
readonly network='midnight-ballot-lab-devnet-isolated'
for container in midnight-ballot-lab-devnet-indexer midnight-ballot-lab-devnet-node midnight-ballot-lab-devnet-prover; do
  if docker container inspect "$container" >/dev/null 2>&1; then
    ownership=$(docker container inspect --format '{{index .Config.Labels "org.midnight-ballot-lab.devnet"}}' "$container")
    [[ "$ownership" == true ]] || { printf '%s\n' 'Unexpected container ownership; cleanup stopped.' >&2; exit 1; }
    docker stop --time 15 "$container" >/dev/null
    docker rm "$container" >/dev/null
    printf '%s\n' "Stopped and removed task-owned $container"
  fi
done
if docker network inspect "$network" >/dev/null 2>&1; then
  ownership=$(docker network inspect --format '{{index .Labels "org.midnight-ballot-lab.devnet"}}' "$network")
  [[ "$ownership" == true ]] || { printf '%s\n' 'Unexpected network ownership; cleanup stopped.' >&2; exit 1; }
  docker network rm "$network" >/dev/null
  printf '%s\n' 'Removed task-owned devnet network'
fi
