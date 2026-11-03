#!/usr/bin/env bash
# Install the reviewed ledger-8 toolchain on the Linux GitHub runner.
set -euo pipefail

cd "$(dirname "$0")/.."
devtools=$(node -p 'JSON.parse(require("fs").readFileSync("contracts/toolchain.json", "utf8")).devtools')
compiler=$(node -p 'JSON.parse(require("fs").readFileSync("contracts/toolchain.json", "utf8")).compiler')
[[ "$devtools" == '0.5.1' ]] || { printf '%s\n' 'Review the new devtools installer digest before upgrading.' >&2; exit 1; }
[[ "$compiler" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 1
[[ "$(uname -s)" == 'Linux' ]] || { printf '%s\n' 'This CI installer requires Linux.' >&2; exit 1; }

installer="${RUNNER_TEMP:?Run on a GitHub Actions runner}/compact-installer.sh"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  "https://github.com/midnightntwrk/compact/releases/download/compact-v${devtools}/compact-installer.sh" \
  --output "$installer"
# Digest published on the official compact-v0.5.1 GitHub release, checked 2026-11-03.
printf '%s  %s\n' '85e74a53ae4a67b31fa4d854f3b6ffb4c29f7c53e3372c5008b6a4729a8b4a73' "$installer" | sha256sum --check --strict
sh "$installer"
export PATH="$HOME/.local/bin:$PATH"
printf '%s\n' "$HOME/.local/bin" >> "${GITHUB_PATH:?}"
compact --version
compact update "$compiler"
compact compile "+$compiler" --version
node --version
npm --version
python3 --version
