#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE4_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE4_LOG_FILE:-$LOG_DIR/manual-verification-phase-4-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[phase4] Logging output to: $LOG_FILE"
echo "[phase4] Running Phase 6 ETL regression and quality gate verification"

bun scripts/verify-etl-phase-6.ts

echo "[phase4] Manual verification automation completed successfully"
