#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE4_DUEL_API_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE4_DUEL_API_LOG_FILE:-$LOG_DIR/manual-verification-phase-4-duel-api-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[phase4-duel-api] Logging output to: $LOG_FILE"
echo "[phase4-duel-api] Step 1/5: coverage gate (module + package thresholds)"
pnpm run coverage:phase4

echo "[phase4-duel-api] Step 2/5: lint"
pnpm lint

echo "[phase4-duel-api] Step 3/5: format check"
pnpm format:check

echo "[phase4-duel-api] Step 4/5: duels route regression suite"
CI=true pnpm --filter @sanctuary/api test -- src/routes/duels.test.ts

echo "[phase4-duel-api] Step 5/5: ai-gen duel assembly + CLI regression suite"
CI=true pnpm --filter @sanctuary/ai-gen test -- src/duel-assembly.test.ts src/cli.test.ts

echo "[phase4-duel-api] Manual verification automation completed successfully"
