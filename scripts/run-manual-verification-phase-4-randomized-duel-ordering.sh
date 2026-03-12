#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE4_RANDOMIZED_DUEL_ORDERING_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE4_RANDOMIZED_DUEL_ORDERING_LOG_FILE:-$LOG_DIR/manual-verification-phase-4-randomized-duel-ordering-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[phase4-randomized] Logging output to: $LOG_FILE"
echo "[phase4-randomized] Running Randomized Duel Ordering Phase 4 documentation verification"

bun scripts/verify-phase4-randomized-duel-ordering.ts

echo "[phase4-randomized] Manual verification automation completed successfully"
