#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE6_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE6_LOG_FILE:-$LOG_DIR/manual-verification-phase-6-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[phase6] Logging output to: $LOG_FILE"
echo "[phase6] Running AI-Gen Phase 6 documentation manual verification"

bun scripts/verify-phase6-ai-gen.ts

echo "[phase6] Manual verification automation completed successfully"
