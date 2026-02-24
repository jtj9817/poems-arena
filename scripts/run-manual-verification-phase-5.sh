#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE5_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE5_LOG_FILE:-$LOG_DIR/manual-verification-phase-5-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[phase5] Logging output to: $LOG_FILE"
echo "[phase5] Running AI-Gen Phase 5 regression and quality-gate manual verification"

bun scripts/verify-phase5-ai-gen.ts

echo "[phase5] Manual verification automation completed successfully"
