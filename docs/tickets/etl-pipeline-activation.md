# [TASK] ETL Pipeline Activation — Full Data Run

**Date:** 2026-02-28
**Status:** Open
**Priority:** High
**Assignee:** —
**Labels:** `etl`, `scraper`, `ai-gen`, `pipeline`

## Context

The ETL pipeline pre-flight is complete (see `etl-pipeline-preflight.md`). The scraper orchestration script (`scripts/run-scrape.ts`), ETL environment configuration, and pipeline observability are all in place. The database currently holds 2 seed poems and 2 duels with no AI counterparts linked via `parent_poem_id`.

This ticket covers the full live activation: scraping all sources, running the ETL pipeline to load human poems, then running `@sanctuary/ai-gen` to generate AI counterparts and assemble duels. The ETL pipeline and AI generation are strictly separate processes — ETL must complete fully before AI generation begins.

## Phase 1: Scrape All Sources

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

## Phase 2: ETL Pipeline

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

## Phase 3: AI Poem Generation

**Prerequisite:** Phase 2 must be fully complete. The ETL pipeline and AI generation are separate processes — never run concurrently against the same database.

**Required env:** `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) must be set. Already present in root `.env`.

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

## Execution Order

1. Run scraper (`scripts/run-scrape.ts`)
2. Validate scraper output (file existence, non-empty)
3. Run ETL dry-run (`--dry-run --include-non-pd`)
4. Run ETL for real (`--include-non-pd`)
5. Validate DB state (poem counts, topic associations)
6. Implement ai-gen rate limiting and retry queue changes
7. Run ai-gen with `--limit 5` to validate
8. Run ai-gen full generation
9. Validate AI counterparts and duel assembly

Steps 1–5 can proceed immediately. Step 6 requires code changes to `@sanctuary/ai-gen` before steps 7–9.
