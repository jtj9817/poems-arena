# Phase 2 Manual Verification: Scraper

The automated tests have passed. For manual verification, please follow these steps:

**Manual Verification Steps:**
1. **Run unit and parser/scraper regression tests with the command:** `CI=true pnpm --filter @sanctuary/scraper test`
2. **Run API DB config isolation tests with the command:** `CI=true pnpm --filter @sanctuary/api test -- src/db/config.test.ts`
3. **Run live scraper integration tests with the command:** `CI=true pnpm --filter @sanctuary/scraper test:live`
4. **Confirm that you receive:** Passing tests for Gutenberg, LOC Poetry 180, and Poets.org scrapers, and passing test-db isolation assertions.
5. **Confirm verbose logging behavior:** rerun any scraper test command with `SCRAPER_VERBOSE=true` and verify `debug` and `info` JSON logs include source metadata and request context.
6. **Confirm test database isolation:** ensure live integration writes to `/tmp/classicist-sanctuary-scraper-live-test.sqlite` (or `SCRAPER_TEST_DB_PATH`) and does not use `LIBSQL_URL`.

## Expected Outcomes

- Scraper tests validate parser correctness and metadata extraction.
- Live integration tests run against network sources when connectivity is available.
- In offline environments, live tests stay deterministic and only validate the isolation harness.
- API DB config in `NODE_ENV=test` requires `LIBSQL_TEST_URL` and never falls back to development DB URL.

## Automation Script

Run `conductor/tracks/poem_scraper_20260219/run-manual-verification-phase-2.sh` to execute all manual verification steps in sequence with automated assertions.
