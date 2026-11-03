#!/usr/bin/env bash
# Read-only ownership check before an operator explicitly discards this dev chain.
# A successful check says nothing about whether transactions have been submitted.
set -euo pipefail
set +x
readonly network='midnight-ballot-lab-devnet-isolated'
readonly node='midnight-ballot-lab-devnet-node'
readonly indexer='midnight-ballot-lab-devnet-indexer'
[[ $# == 0 ]] || exit 2

check_container() {
  local name="$1" expected_image="$2" actual_name image owned attached mounts
  actual_name=$(docker inspect --format '{{.Name}}' "$name")
  image=$(docker inspect --format '{{.Config.Image}}' "$name")
  owned=$(docker inspect --format '{{index .Config.Labels "org.midnight-ballot-lab.devnet"}}' "$name")
  attached=$(docker inspect --format '{{range $name, $settings := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$name")
  mounts=$(docker inspect --format '{{len .Mounts}}' "$name")
  if [[ "$actual_name" != "/$name" || "$image" != "$expected_image" || "$owned" != true || "$attached" != "$network" || "$mounts" != 0 ]]; then
    printf '%s\n' 'Local resource check failed; no resources were changed.' >&2
    exit 1
  fi
  docker inspect --format '{{.Name}} image={{.Config.Image}} status={{.State.Status}} mounts={{len .Mounts}} hostBindings={{json .HostConfig.PortBindings}} effectivePorts={{json .NetworkSettings.Ports}}' "$name"
}
check_container "$node" midnightntwrk/midnight-node:1.0.400
check_container "$indexer" midnightntwrk/indexer-standalone:4.3.5
network_label=$(docker network inspect --format '{{index .Labels "org.midnight-ballot-lab.devnet"}}' "$network")
network_count=$(docker network inspect --format '{{len .Containers}}' "$network")
network_names=$(docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' "$network" | sed '/^[[:space:]]*$/d' | sort)
if [[ "$network_label" != true || "$network_count" != 2 || "$network_names" != "$(printf '%s\n' "$node" "$indexer" | sort)" ]]; then
  printf '%s\n' 'Local network ownership check failed; no resources were changed.' >&2
  exit 1
fi
docker network inspect --format '{{.Name}} driver={{.Driver}} internal={{.Internal}} containers={{len .Containers}}' "$network"
printf '%s\n' 'Exact local service ownership verified. No resources changed; chain history has not been checked.'
