#!/usr/bin/env bash
# Install the network-compatible official compiler in Ubuntu/WSL.
set -euo pipefail
command -v unzip >/dev/null || { printf '%s\n' 'Install unzip in Ubuntu before running this installer.' >&2; exit 1; }
installer="$(mktemp)"
trap 'rm -f "$installer"' EXIT
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  https://github.com/midnightntwrk/compact/releases/download/compact-v0.5.1/compact-installer.sh \
  --output "$installer"
printf '%s  %s\n' '85e74a53ae4a67b31fa4d854f3b6ffb4c29f7c53e3372c5008b6a4729a8b4a73' "$installer" | sha256sum --check
sh "$installer"
export PATH="$HOME/.local/bin:$PATH"
compact --version
artifact_directory="${COMPACT_DIRECTORY:-$HOME/.compact-ballot-lab}"
compact --directory "$artifact_directory" update 0.31.1
compact --directory "$artifact_directory" compile +0.31.1 --version
