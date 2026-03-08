# [TASK] ETL Pipeline Pre-Flight Setup

**Date:** 2026-02-27
**Status:** Complete
**Priority:** High
**Assignee:** —
**Labels:** `etl`, `scraper`, `devops`, `observability`

## Verification Update (2026-03-08)

Verified against the current repo state:

- `scripts/run-scrape.ts` exists and orchestrates all three scrapers.
- `packages/etl/.env` exists, and `.env` files are gitignored at the repo root.
- ETL timing and summary logging are implemented in `packages/etl/src/index.ts` and `packages/etl/src/logger.ts`.
- Prior scraper outputs and ETL stage outputs exist under `packages/scraper/data/raw/` and `packages/etl/data/`.

This ticket's pre-flight work is complete and should no longer be tracked as open work.

## Summary

The ETL pipeline (`@sanctuary/etl`) and scraper (`@sanctuary/scraper`) packages are fully implemented but have never been executed end-to-end. Before initializing the data pipeline to scrape poems and generate AI counterparts, several pre-flight items must be completed: a scraper orchestration script, environment configuration, and enhanced observability.

## Background

- **Scraper**: Three source scrapers exist (Gutenberg, LOC 180, Poets.org) but there is no CLI runner that ties them together. `packages/scraper/data/raw/` is empty.
- **ETL**: Four stages (clean → dedup → tag → load) are implemented. `packages/etl/.env` does not exist — the load stage will fail without it.
- **Logging**: The scraper has structured JSON logging. The ETL uses bare `console.log` with no timing, progress counters, or summary reporting.
- **AI-Gen**: `@sanctuary/ai-gen` runs after ETL and requires a Gemini API key (`GEMINI_API_KEY` or `GOOGLE_API_KEY`).

## Acceptance Criteria

- [ ] Scraper orchestration script (`scripts/run-scrape.ts`) can invoke all three scrapers and write JSON to `packages/scraper/data/raw/`
- [ ] `packages/etl/.env` exists with valid Turso credentials and is gitignored
- [ ] ETL pipeline prints elapsed time per stage and a final summary report
- [ ] `bun scripts/run-scrape.ts --sources gutenberg` succeeds and writes output
- [ ] `pnpm --filter @sanctuary/etl run pipeline --dry-run --limit 10` completes with enhanced logging visible

## Subtasks

### 1. Create Scraper Orchestration Script
**File:** `scripts/run-scrape.ts`

A Bun script that calls each scraper function and writes results via `writeScrapedPoems()`. CLI flags for source selection and Poets.org page limit. Each source wrapped in try/catch so one failure doesn't abort the rest.

### 2. Configure ETL Environment
**Action:** Copy `packages/etl/.env.example` → `packages/etl/.env` and populate with Turso credentials from root `.env`. Verify the file is covered by `.gitignore`.

### 3. Add ETL Pipeline Observability
**Files:** `packages/etl/src/logger.ts` (new), `packages/etl/src/index.ts` (modify)

Lightweight logger with timestamp prefixes and elapsed time tracking. Wrap each stage with start/end timing. Print a bordered summary table at pipeline completion. No new dependencies — uses `performance.now()` and existing console output style.

### 4. Verification
Run the scraper on a single source, then dry-run the ETL pipeline to confirm the full chain works without writing to the database.

## Risks & Notes

- LOC 180 poems are mostly non-public-domain — ETL filters these out by default
- Gutenberg scraper only covers Emerson (small initial dataset)
- Poets.org scraping is rate-limited (5 concurrent, 200ms delay) — larger page counts will take time
- `poetry-foundation` source exists in type definitions but has no scraper implementation
- AI-Gen is out of scope for this ticket (separate step after human poems are loaded)
