# [TASK] ETL Pipeline Activation — Full Data Run

**Date:** 2026-02-28
**Status:** In Progress
**Priority:** High
**Assignee:** —
**Labels:** `etl`, `scraper`, `ai-gen`, `pipeline`

**Children:**
- [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md) — Improve LOC 180 scraper to avoid 429 throttling
- [`ai-gen-deepseek-migration.md`](ai-gen-deepseek-migration.md) — Migrate AI generation from Gemini to DeepSeek

## Context

The ETL pipeline pre-flight is complete (see `etl-pipeline-preflight.md`). The scraper orchestration script (`scripts/run-scrape.ts`), ETL environment configuration, and pipeline observability are all in place. The database currently holds 2 seed poems and 2 duels with no AI counterparts linked via `parent_poem_id`.

This ticket covers the full live activation: scraping all sources, running the ETL pipeline to load human poems, then running `@sanctuary/ai-gen` to generate AI counterparts and assemble duels. The ETL pipeline and AI generation are strictly separate processes — ETL must complete fully before AI generation begins.

## Phase 1: Scrape All Sources ✅ Complete (partial — see notes)

**Command:**
```bash
bun scripts/run-scrape.ts --sources gutenberg,loc-180,poets-org --poets-org-pages 5
```

**Expected output:**
- Gutenberg (Emerson): ~224 public-domain poems
- LOC Poetry 180: ~180 poems (most non-public-domain)
- Poets.org (5 pages): variable count, mix of public/non-public-domain

Output written to `packages/scraper/data/raw/` as timestamped JSON files per source.

**Validation:** Confirm all three JSON files exist and contain non-empty arrays. Check scrape summary for failures.

**Actual results (2026-03-01):**
- Gutenberg: **224 poems** ✓
- LOC Poetry 180: **65 of ~180 poems** — LOC servers returned 429 on the majority of concurrent requests. Existing rate limiter (`concurrency: 5, minDelay: 200ms`) was too aggressive. See child ticket [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md).
- Poets.org: **100 poems** ✓
- Total: **389 poems across 3 files** — all files exist and are non-empty

## Phase 2: ETL Pipeline ✅ Complete

**Command:**
```bash
# Dry-run first to validate counts
pnpm --filter @sanctuary/etl run pipeline --dry-run --include-non-pd

# Full run with non-public-domain poems included
pnpm --filter @sanctuary/etl run pipeline --include-non-pd
```

**Key flag:** `--include-non-pd` is required to load LOC 180 poems (which are mostly contemporary/copyrighted). Without it, only public-domain poems (primarily Gutenberg) are loaded.

**Stage expectations:**
1. **Clean** — Normalize Unicode, strip HTML, reject poems with <4 lines. Some Gutenberg entries may be filtered (headings, notes).
2. **Dedup** — Merge duplicates across sources by fuzzy title+author matching. Source priority: poets.org > loc-180 > gutenberg. Provenance records merged.
3. **Tag** — Map raw themes to canonical topics (20 defined). Keyword fallback for untagged poems. Max 3 topics per poem.
4. **Load** — Upsert poems (type=HUMAN), topic associations, and scrape provenance into Turso. Deterministic IDs via SHA-256 of (title, author).

**Validation:** Check pipeline summary for loaded count. Query DB to confirm poem count increased. Verify topic associations exist.

```sql
SELECT type, count(*) FROM poems GROUP BY type;
SELECT t.label, count(*) FROM poem_topics pt JOIN topics t ON t.id = pt.topic_id GROUP BY t.label ORDER BY count(*) DESC;
```

**Actual results (2026-03-01):**
- Clean: 389 in → 377 valid (12 skipped — Gutenberg headings/short entries)
- Dedup: 377 → 362 (15 duplicates dropped)
- Tag: 362 tagged (329 via keyword fallback)
- Load: **362 poems loaded**, 20 topics upserted, 809 topic associations
- DB state: HUMAN: 364, AI: 2 (pre-existing seeds)

## Phase 3: AI Poem Generation ⚠️ Partially Complete

**Prerequisite:** Phase 2 must be fully complete. The ETL pipeline and AI generation are separate processes — never run concurrently against the same database.

**Required env:** `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) must be set. Already present in root `.env`.

> **Note:** Full generation run is blocked pending migration to DeepSeek. See child ticket [`ai-gen-deepseek-migration.md`](ai-gen-deepseek-migration.md). Steps 8–9 below must be re-run after migration is complete.

### Rate Limiting Changes Required

The current `@sanctuary/ai-gen` CLI (`packages/ai-gen/src/cli.ts`) uses a simple concurrency limiter (`p-limit` or fallback) with no per-minute rate cap. The following changes are required before the live run:

**Global rate limit:** Maximum 5 requests per minute across all 3 concurrency slots. This is a sliding-window or token-bucket constraint layered on top of the existing concurrency limiter — not a replacement. When the rate limit is hit, in-flight slots should block until the next minute window opens.

**Retry queue with priority:** Failed requests must be re-queued rather than discarded. The queue must process failed retries before new poems. Current behavior: `processPoem` failures are logged and counted but not retried at the queue level (only `maxRetries` within `generateCounterpartForPoem` handles retries). The new behavior:
- When `processPoem` returns `status: 'failed'`, push it back into the work queue.
- Failed items are dequeued before new items (priority queue: failed-first).
- Track retry count per poem. Cap at `maxRetries` total attempts across all queue cycles (default: 2). After exhausting retries, mark as permanently failed.

**Elapsed time logging:** Add per-poem timing (start → end, elapsed ms) and a running total logged after each poem completes. At the end, log a summary with:
- Total elapsed wall time
- Average time per poem (stored only, excluding skips/failures)
- Rate limit wait time (cumulative time spent waiting on the RPM cap)

### Generation Command

```bash
# Start with a small batch to validate
pnpm --filter @sanctuary/ai-gen run generate --limit 5 --concurrency 3

# Full run after validation
pnpm --filter @sanctuary/ai-gen run generate --concurrency 3
```

**Post-generation:** Duel assembly runs automatically via `assembleAfterRun()` hook after generation completes.

### Implementation Details

**Files to modify:**
- `packages/ai-gen/src/cli.ts` — Replace `resolveLimiter` and the `tasks.map`/`Promise.all` block with a rate-limited priority queue. Add elapsed time tracking and summary logging.
- `packages/ai-gen/src/index.ts` — No structural changes expected; `CliDependencies` interface may need a timestamp helper if DI is preferred for testability.

**Current concurrency implementation** (`cli.ts:51-95`): `createConcurrencyLimiter` is a basic semaphore with a FIFO queue. `resolveLimiter` tries `p-limit` first, falls back to the built-in. Neither enforces RPM limits.

**Current retry implementation** (`generation-service.ts`): `generateCounterpartForPoem` retries internally on retryable quality issues up to `maxRetries`. Non-retryable failures (invalid output shape) skip immediately. This inner retry loop handles per-attempt retries within a single Gemini call chain — the new queue-level retry is a separate, outer layer that re-processes the entire `processPoem` call.

### Validation

```sql
-- Confirm AI poems linked to human counterparts
SELECT count(*) FROM poems WHERE type = 'AI' AND parent_poem_id IS NOT NULL;

-- Confirm duels were assembled
SELECT count(*) FROM duels;

-- Spot-check a duel pairing
SELECT d.id, d.topic, pa.title as poem_a, pa.type as type_a, pb.title as poem_b, pb.type as type_b
FROM duels d
JOIN poems pa ON pa.id = d.poem_a_id
JOIN poems pb ON pb.id = d.poem_b_id
LIMIT 5;
```

**Bugs found and fixed during activation run (2026-03-01):**
1. `packages/ai-gen/src/index.ts` — Interface re-exports missing `type` keyword; caused Bun ESM linker failure at startup. Fixed by adding `type` modifier to all type-only re-exports.
2. `packages/ai-gen/.env` — Missing env file; `LIBSQL_URL` not found when running via `pnpm --filter`. Created from root `.env` (mirrors `packages/etl/.env` pattern).
3. `packages/ai-gen/src/persistence.ts` — `persistGeneratedPoem` did not copy parent poem's `poem_topics` rows to the AI poem, causing duel assembly to produce 0 candidates. Fixed by adding `INSERT OR IGNORE INTO poem_topics SELECT ?, topic_id FROM poem_topics WHERE poem_id = ?` after poem insert. Backfilled topics for 5 already-generated AI poems.

**Actual results (batch run — 5 poems, 2026-03-01):**
- 5/5 AI poems stored ✓
- Rate limiter triggered (37s of 86s total wall time on rate-limit wait) ✓
- Retry queue: 1 poem hit 429, retried successfully ✓
- Duel assembly: pending re-run after topic backfill confirmation

## Execution Order

1. ~~Run scraper (`scripts/run-scrape.ts`)~~ — ✅ Done (389 poems; LOC partial — see Phase 1 notes)
2. ~~Validate scraper output (file existence, non-empty)~~ — ✅ Done
3. ~~Run ETL dry-run (`--dry-run --include-non-pd`)~~ — ✅ Done
4. ~~Run ETL for real (`--include-non-pd`)~~ — ✅ Done (362 poems loaded)
5. ~~Validate DB state (poem counts, topic associations)~~ — ✅ Done (364 HUMAN, 809 topic associations)
6. ~~Implement ai-gen rate limiting and retry queue changes~~ — ✅ Done
7. ~~Run ai-gen with `--limit 5` to validate~~ — ✅ Done (5/5 stored; 3 bugs fixed during run)
8. Run ai-gen full generation — ⏸ Blocked (pending DeepSeek migration)
9. Validate AI counterparts and duel assembly — ⏸ Pending step 8

Steps 8–9 are blocked on [`ai-gen-deepseek-migration.md`](ai-gen-deepseek-migration.md). LOC re-scrape can be done independently via [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md).
