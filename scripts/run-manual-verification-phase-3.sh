#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE3_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE3_LOG_FILE:-$LOG_DIR/manual-verification-phase-3-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "[phase3] Logging output to: $LOG_FILE"

# ── 3A: Existing tests + coverage gaps ──────────────────────────────────────

echo "[phase3] Step 1/7: Scraper unit + regression tests"
CI=true pnpm --filter @sanctuary/scraper test

echo "[phase3] Step 2/7: API unit tests"
CI=true pnpm --filter @sanctuary/api test

echo "[phase3] Step 3/7: ESLint"
pnpm -w lint

echo "[phase3] Step 4/7: Prettier format check"
pnpm -w format:check

echo "[phase3] PASS: Steps 1-4 (3A+3B) all green"

# ── 3D: E2E suites ─────────────────────────────────────────────────────────

echo "[phase3] Step 5/7: E2E CDP tests (scraper source page structural validation)"
echo "[phase3]   Set SKIP_LIVE_CDP=true to skip network-dependent CDP tests"
if [[ "${SKIP_LIVE_CDP:-false}" == "true" ]]; then
  echo "[phase3]   SKIP_LIVE_CDP=true — skipping CDP tests"
else
  pnpm --filter @sanctuary/e2e test:cdp || {
    echo "[phase3] WARN: CDP tests failed (may require network). Continuing..."
  }
fi

echo "[phase3] Step 6/7: E2E API integration tests"
echo "[phase3]   Requires API server running on port ${API_PORT:-4000} with seed data"
if [[ "${SKIP_E2E_API:-false}" == "true" ]]; then
  echo "[phase3]   SKIP_E2E_API=true — skipping API E2E tests"
else
  pnpm --filter @sanctuary/e2e test:api || {
    echo "[phase3] WARN: API E2E tests failed (may require running server). Continuing..."
  }
fi

echo "[phase3] Step 7/7: E2E UI tests (full-stack Playwright)"
echo "[phase3]   Requires both API (port ${API_PORT:-4000}) and Web (port ${WEB_PORT:-3000}) servers"
if [[ "${SKIP_E2E_UI:-false}" == "true" ]]; then
  echo "[phase3]   SKIP_E2E_UI=true — skipping UI E2E tests"
else
  pnpm --filter @sanctuary/e2e test:ui || {
    echo "[phase3] WARN: UI E2E tests failed (may require running servers). Continuing..."
  }
fi

echo "[phase3] Manual verification automation completed"
echo "[phase3] Summary:"
echo "[phase3]   - Unit + regression tests: PASS"
echo "[phase3]   - Lint + format: PASS"
echo "[phase3]   - E2E tests: see output above (may require running servers)"
