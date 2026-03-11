#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE3_RANDOMIZED_DUEL_ORDERING_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE3_RANDOMIZED_DUEL_ORDERING_LOG_FILE:-$LOG_DIR/manual-verification-phase-3-randomized-duel-ordering-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[phase3-randomized] Logging output to: $LOG_FILE"
echo "[phase3-randomized] Running Randomized Duel Ordering Phase 3 regression and quality-gate verification"

bun scripts/verify-phase3-randomized-duel-ordering.ts

echo "[phase3-randomized] Manual verification automation completed successfully"
