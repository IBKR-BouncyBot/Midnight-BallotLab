#!/usr/bin/env bash
# CI-only process bridge. Private stdout and browser profiles are never artifacts.
set -euo pipefail
umask 077

fail() { printf '%s\n' "$1" >&2; exit 1; }
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux ]] || fail 'This bridge runs only on the Linux CI runner.'
[[ "${GITHUB_REPOSITORY:-}" == IBKR-BouncyBot/Midnight-BallotLab && "${GITHUB_REF:-}" == refs/heads/main ]] || fail 'A trusted main-branch dispatch is required.'
[[ "${GITHUB_RUN_ATTEMPT:-}" == 1 ]] || fail 'Workflow reruns are disabled. Review any funding or submission before a fresh dispatch.'
temp_root="$(realpath -e -- "${RUNNER_TEMP:?}")"
mode="${1:-}"

check_task() {
  task="$(realpath -e -- "${LACE_TASK_DIR:?}")"
  [[ "$task" == "$temp_root"/midnight-lace-ci.* && -f "$task/task-owned" ]] || fail 'Invalid task directory.'
  [[ "$(cat "$task/task-owned")" == "midnight-ballot-lab/lace-preview-ci/v1" ]] || fail 'Invalid task ownership.'
}

owned_process() {
  local candidate="$1"
  [[ "$candidate" =~ ^[1-9][0-9]*$ ]] || return 1
  python3 - "$candidate" "$task" <<'PY'
import os,sys
from pathlib import Path
try:
    pid=int(sys.argv[1]);task=os.fsencode(sys.argv[2])
    args=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
    env=Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
    assert b'supervise' in args and any(arg.endswith(b'/ci-lace-preview-process.sh') for arg in args)
    assert b'LACE_TASK_DIR='+task in env and os.getpgid(pid)==pid
except Exception:
    sys.exit(1)
PY
}

stop_owned() {
  [[ -f "$task/runner.pid" ]] || return 0
  local pid
  pid="$(cat "$task/runner.pid")"
  if owned_process "$pid"; then
    kill -TERM -- "-$pid" 2>/dev/null || true
    for _ in $(seq 1 15); do
      owned_process "$pid" || return 0
      sleep 1
    done
    if owned_process "$pid"; then kill -KILL -- "-$pid" 2>/dev/null || true; fi
  fi
}

case "$mode" in
  start)
    [[ -n "${LACE_EXTENSION_PATH:-}" && -f "${LACE_ACQUISITION_REPORT:-}" ]] || fail 'Verified Lace acquisition is required.'
    task="$(mktemp -d "$temp_root/midnight-lace-ci.XXXXXXXX")"
    chmod 700 "$task"
    printf '%s\n' 'midnight-ballot-lab/lace-preview-ci/v1' > "$task/task-owned"
    mkdir -m 700 "$task/public"
    date +%s > "$task/started-at"
    export LACE_TASK_DIR="$task" LACE_EVIDENCE_DIR="$task/public"
    setsid bash "$(realpath -e -- "$0")" supervise </dev/null >/dev/null 2>&1 &
    printf '%s\n' "$!" > "$task/runner.pid"
    printf 'task-directory=%s\nevidence-directory=%s\n' "$task" "$task/public" >> "${GITHUB_OUTPUT:?}"
    printf '%s\n' 'Started one isolated Lace Preview runner; only public reports will be uploaded.'
    ;;
  supervise)
    check_task
    trap 'printf "143\n" > "$task/exit-code.tmp"; mv -- "$task/exit-code.tmp" "$task/exit-code"; exit 143' TERM INT
    set +e
    xvfb-run -a node scripts/test-lace-preview-browser.mjs > "$task/private-runner.log" 2>&1
    code=$?
    set -e
    printf '%s\n' "$code" > "$task/exit-code.tmp"
    mv -- "$task/exit-code.tmp" "$task/exit-code"
    ;;
  funding)
    check_task
    deadline=$(( $(cat "$task/started-at") + 20 * 60 ))
    while [[ ! -f "$task/public/funding-request.json" ]]; do
      node scripts/ci-lace-preview-progress.mjs
      [[ ! -f "$task/exit-code" ]] || fail 'The browser runner stopped before publishing a funding request. Inspect public failure evidence.'
      (( $(date +%s) < deadline )) || fail 'The funding-request startup deadline expired; no automatic restart will occur.'
      sleep 5
    done
    node scripts/ci-lace-preview-progress.mjs
    node scripts/ci-lace-preview-public-check.mjs funding "$task/public/funding-request.json"
    printf '%s\n' 'A public Preview funding request is ready for the authorized external funding step.'
    ;;
  wait)
    check_task
    deadline=$(( $(cat "$task/started-at") + 180 * 60 ))
    while [[ ! -f "$task/exit-code" ]]; do
      node scripts/ci-lace-preview-progress.mjs
      (( $(date +%s) < deadline )) || { stop_owned; fail 'The overall browser-runner deadline expired; no automatic restart will occur.'; }
      sleep 10
    done
    node scripts/ci-lace-preview-progress.mjs
    [[ "$(cat "$task/exit-code")" == 0 ]] || fail 'The browser runner did not complete successfully. Inspect public failure evidence; do not retry a submitted operation.'
    node scripts/ci-lace-preview-public-check.mjs completed "$task/public/browser-report.json"
    printf '%s\n' 'The runner completed nine configured-indexer-accepted Preview operations.'
    ;;
  stop)
    check_task
    stop_owned
    ;;
  *) fail 'Unsupported CI bridge mode.' ;;
esac
