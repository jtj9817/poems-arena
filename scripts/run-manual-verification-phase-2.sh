#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

LOG_DIR="${PHASE2_LOG_DIR:-$ROOT_DIR/logs}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="${PHASE2_LOG_FILE:-$LOG_DIR/manual-verification-phase-2-$TIMESTAMP.log}"
mkdir -p "$(dirname "$LOG_FILE")"

exec > >(tee -a "$LOG_FILE") 2>&1
echo "[phase2] Logging output to: $LOG_FILE"

echo "[phase2] Step 1/6: scraper regression tests"
CI=true pnpm --filter @sanctuary/scraper test

echo "[phase2] Step 2/6: API test DB config isolation tests"
CI=true pnpm --filter @sanctuary/api test -- src/db/config.test.ts

echo "[phase2] Step 3/6: live scraper integration suite"
CI=true pnpm --filter @sanctuary/scraper test:live

echo "[phase2] Step 4/6: ensure core test commands passed"
echo "[phase2] PASS: steps 1-3 completed successfully"

echo "[phase2] Step 5/6: verify verbose structured logging"
verbose_output="$({ CI=true SCRAPER_VERBOSE=true pnpm --filter @sanctuary/scraper test -- src/scrapers/loc-180.test.ts; } 2>&1)"
printf '%s\n' "$verbose_output"

if ! grep -q '"level":"debug"' <<<"$verbose_output"; then
  echo "[phase2] FAIL: missing debug log output under SCRAPER_VERBOSE=true" >&2
  exit 1
fi

if ! grep -q '"level":"info"' <<<"$verbose_output"; then
  echo "[phase2] FAIL: missing info log output under SCRAPER_VERBOSE=true" >&2
  exit 1
fi

if ! grep -q '"source":"loc-180"' <<<"$verbose_output"; then
  echo "[phase2] FAIL: missing source metadata in verbose logs" >&2
  exit 1
fi

if ! grep -q '"sourceUrl":"https://www.loc.gov/.*poetry-180-001.*"' <<<"$verbose_output"; then
  echo "[phase2] FAIL: missing sourceUrl request context in verbose logs" >&2
  exit 1
fi

echo "[phase2] Step 6/6: verify isolated scraper test DB path and non-LIBSQL_URL usage"
test_db_path="/tmp/classicist-sanctuary-scraper-phase2-manual-$$.sqlite"
rm -f "$test_db_path"

CI=true \
SCRAPER_LIVE_TESTS=true \
SCRAPER_VERBOSE=true \
SCRAPER_TEST_DB_PATH="$test_db_path" \
SCRAPER_TEST_DB_KEEP=true \
bun test packages/scraper/src/scrapers/live-scrape.test.ts

if [[ ! -f "$test_db_path" ]]; then
  echo "[phase2] FAIL: expected scraper test DB file not found at $test_db_path" >&2
  exit 1
fi

bun --eval "import { resolveDbConfig } from './apps/api/src/db/config.ts';
const cfg = resolveDbConfig({
  NODE_ENV: 'test',
  LIBSQL_URL: 'libsql://development-db.example.com',
  LIBSQL_TEST_URL: 'libsql://manual-test-db.example.com',
  LIBSQL_AUTH_TOKEN: 'dev-token',
  LIBSQL_TEST_AUTH_TOKEN: 'test-token',
});
if (cfg.url !== 'libsql://manual-test-db.example.com') {
  throw new Error('test mode config did not prefer LIBSQL_TEST_URL');
}
console.log('[phase2] PASS: API config resolves LIBSQL_TEST_URL in test mode');"

rm -f "$test_db_path"

echo "[phase2] Manual verification automation completed successfully"
