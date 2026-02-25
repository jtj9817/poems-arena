#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Debug Prettier timeout/hang behavior with repeatable diagnostics.

Usage:
  scripts/debug-prettier-timeout.sh [--run "<command>"] [--timeout-sec N] [--out-dir PATH]
  scripts/debug-prettier-timeout.sh --attach-pid <pid> [--trace-sec N] [--out-dir PATH]

Examples:
  scripts/debug-prettier-timeout.sh
  scripts/debug-prettier-timeout.sh --run "pnpm exec prettier --check . --log-level debug"
  scripts/debug-prettier-timeout.sh --attach-pid 1517759 --trace-sec 30

Notes:
  - Default run command: pnpm format:check
  - `--run` traces from process start (works better under ptrace restrictions).
  - `--attach-pid` attempts live attach with strace.
EOF
}

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

MODE="run"
RUN_CMD="pnpm format:check"
ATTACH_PID=""
RUN_TIMEOUT_SEC=240
TRACE_SEC=30
OUT_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run)
      MODE="run"
      RUN_CMD="${2:-}"
      shift 2
      ;;
    --attach-pid)
      MODE="attach"
      ATTACH_PID="${2:-}"
      shift 2
      ;;
    --timeout-sec)
      RUN_TIMEOUT_SEC="${2:-}"
      shift 2
      ;;
    --trace-sec)
      TRACE_SEC="${2:-}"
      shift 2
      ;;
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="$ROOT_DIR/logs/prettier-timeout-debug-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$OUT_DIR"

RUN_LOG="$OUT_DIR/run.log"
SUMMARY="$OUT_DIR/summary.txt"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" | tee -a "$RUN_LOG"
}

capture_system_context() {
  {
    echo "=== context ==="
    echo "cwd: $ROOT_DIR"
    echo "user: $(id -un) (uid=$(id -u))"
    echo "hostname: $(hostname)"
    echo "date_utc: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "kernel: $(uname -a)"
    echo "bun: $(bun --version 2>/dev/null || echo unavailable)"
    echo "node: $(node --version 2>/dev/null || echo unavailable)"
    echo "pnpm: $(pnpm --version 2>/dev/null || echo unavailable)"
    echo "strace: $(strace -V 2>/dev/null | head -n 1 || echo unavailable)"
    echo "ptrace_scope: $(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo unknown)"
    echo
  } > "$OUT_DIR/context.txt"
}

capture_process_snapshot() {
  local label="$1"
  local file="$OUT_DIR/ps-${label}.txt"
  {
    echo "=== ps snapshot (${label}) ==="
    ps -eo pid,ppid,pgid,state,stat,etime,pcpu,pmem,command \
      | grep -E 'PID|prettier|pnpm|bun scripts/verify-phase5-ai-gen.ts|eslint'
    echo
    echo "=== matching format-check commands ==="
    pgrep -af 'prettier.*--check|pnpm.*format:check' || true
  } > "$file"
}

write_summary() {
  local mode="$1"
  local exit_code="$2"
  {
    echo "mode=$mode"
    echo "exit_code=$exit_code"
    echo "out_dir=$OUT_DIR"
    echo "run_log=$RUN_LOG"
    echo "context=$OUT_DIR/context.txt"
    echo "stdout=$OUT_DIR/command.stdout.log"
    echo "stderr=$OUT_DIR/command.stderr.log"
    echo "strace_err=$OUT_DIR/strace.stderr.log"
    if compgen -G "$OUT_DIR/strace*" > /dev/null; then
      echo "strace_files:"
      ls -1 "$OUT_DIR"/strace* 2>/dev/null | sed 's/^/  - /'
    fi
    echo "snapshots:"
    ls -1 "$OUT_DIR"/ps-*.txt 2>/dev/null | sed 's/^/  - /'
  } > "$SUMMARY"
}

capture_system_context
capture_process_snapshot "start"

if [[ "$MODE" == "run" ]]; then
  log "mode=run command=\"$RUN_CMD\" timeout_sec=$RUN_TIMEOUT_SEC out_dir=$OUT_DIR"

  set +e
  timeout --signal=TERM --kill-after=5s "${RUN_TIMEOUT_SEC}" \
    strace -ff -tt -T -s 256 -yy -o "$OUT_DIR/strace" \
    bash -lc "$RUN_CMD" \
    >"$OUT_DIR/command.stdout.log" \
    2>"$OUT_DIR/command.stderr.log"
  EXIT_CODE=$?
  set -e

  if [[ -s "$OUT_DIR/command.stderr.log" ]]; then
    cp "$OUT_DIR/command.stderr.log" "$OUT_DIR/strace.stderr.log"
  fi

  capture_process_snapshot "after-run"
  log "run finished exit_code=$EXIT_CODE"
  write_summary "run" "$EXIT_CODE"

  log "summary file: $SUMMARY"
  log "tip: share $OUT_DIR (especially strace*, command.stdout.log, command.stderr.log)"
  exit "$EXIT_CODE"
fi

if [[ "$MODE" == "attach" ]]; then
  if [[ -z "$ATTACH_PID" ]]; then
    echo "--attach-pid requires a PID" >&2
    exit 1
  fi
  if ! kill -0 "$ATTACH_PID" 2>/dev/null; then
    echo "PID $ATTACH_PID is not running or inaccessible." >&2
    exit 1
  fi

  log "mode=attach pid=$ATTACH_PID trace_sec=$TRACE_SEC out_dir=$OUT_DIR"
  set +e
  timeout --signal=INT "${TRACE_SEC}" \
    strace -f -tt -T -s 256 -yy -o "$OUT_DIR/strace.attach.log" -p "$ATTACH_PID" \
    >"$OUT_DIR/command.stdout.log" \
    2>"$OUT_DIR/strace.stderr.log"
  EXIT_CODE=$?
  set -e

  capture_process_snapshot "after-attach"
  log "attach finished exit_code=$EXIT_CODE"
  if grep -qi "Operation not permitted" "$OUT_DIR/strace.stderr.log" 2>/dev/null; then
    log "ptrace denied. Retry with sudo or lower ptrace_scope on your machine."
  fi

  write_summary "attach" "$EXIT_CODE"
  log "summary file: $SUMMARY"
  log "tip: share $OUT_DIR (especially strace.attach.log + strace.stderr.log)"
  exit "$EXIT_CODE"
fi
