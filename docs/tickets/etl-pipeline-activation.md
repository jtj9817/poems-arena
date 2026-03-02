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

**Required env:** `DEEPSEEK_API_KEY` must be set in `packages/ai-gen/.env`. See `packages/ai-gen/.env.example`.

> **Note:** The Gemini → DeepSeek migration is complete (commits `3fc74f1`, `ca090d7`). `GEMINI_API_KEY` is no longer required. Steps 8–9 are unblocked.

### Implemented Queue and Error Behaviour

The following behaviours are already implemented in the current `@sanctuary/ai-gen` codebase:

**Concurrency and retry queue (`cli.ts`):**
- A worker pool processes poems up to `--concurrency` in parallel (default: 3).
- Per-poem elapsed time is tracked and logged after each result. A run summary logs total wall time and average time per stored poem.
- When `processPoem` returns `status: 'failed'`, the poem is pushed to `failedQueue` and dequeued before new poems (priority: failed-first). Retry count is tracked per poem and capped at `--max-retries` CLI cycles (default: 2), giving each poem up to 3 full `processPoem` attempts within the run.
- Poems that exhaust all CLI retries are logged as permanently failed and remain in the unmatched pool for the next run.

**Error discrimination (`generation-service.ts`):**
- `generateCounterpartForPoem` retries application-level failures — empty content, missing fields, invalid JSON (`PoemGenerationError`/`VerificationError` without `.cause`) — up to `maxRetries` times (default: 2, so 3 attempts total).
- Network errors (SDK-wrapped, carry `.cause`) are rethrown immediately; the OpenAI SDK has already exhausted its own retries (`maxRetries: 2`).
- Worst-case requests per persistently failing poem: 9 (3 SDK × 1 service pass-through × 3 CLI). Previous worst-case before fix was 27 (3 × 3 × 3).

**DeepSeek rate limits:**
- DeepSeek enforces a dynamic rate limit (no hard static cap). 429 and 5xx errors are handled automatically by the OpenAI SDK (`maxRetries: 2`). No local rate limiter is needed.
- Under high server load, connections are kept alive while the server queues the request. A 30s per-request timeout prevents indefinite hangs.

### Generation Command

This is a long-running job (~1–2 hours for ~359 poems). Use the supervised wrapper script rather than calling the package directly — it handles session expiry, structured check-ins, and automatic failure detection.

```bash
# Preferred: monitored wrapper (writes status + report files to logs/)
bun scripts/run-generate.ts --concurrency 3

# Direct package invocation (no monitoring, not recommended for agents)
pnpm --filter @sanctuary/ai-gen run generate --concurrency 3
```

**Post-generation:** Duel assembly runs automatically via the `assembleAfterRun()` hook in both invocation paths.

### Full Run Activation

**Known DB state entering this step (as of 2026-03-01 batch run):**

| Table | Count | Notes |
|---|---|---|
| `poems` WHERE `type = 'HUMAN'` | 364 | 362 from ETL + 2 pre-existing seeds |
| `poems` WHERE `type = 'AI'` | 7 | 2 pre-existing seeds (no `parent_poem_id`), 5 from batch validation run (with `parent_poem_id`) |
| Unmatched human poems | ~359 | Human poems with no AI counterpart — these are the generation targets |
| `duels` | TBD | Pending re-confirmation after topic backfill (see batch run notes below) |

**Verify state before running:**

```sql
-- Confirm unmatched human poem count — this is how many AI poems will be generated
SELECT count(*) FROM poems p
WHERE p.type = 'HUMAN'
  AND NOT EXISTS (
    SELECT 1 FROM poems ai WHERE ai.parent_poem_id = p.id
  );
-- Expected: ~359

-- Confirm overall poem counts
SELECT type, count(*) FROM poems GROUP BY type;
-- Expected: HUMAN 364, AI 7
```

**Run the full generation (AI agent instructions):**

Because this job runs for ~1–2 hours, an AI agent must treat it as a background process with periodic check-ins. The `run-generate.ts` wrapper handles everything that can't be managed inline: session expiry, structured progress state, and automatic failure detection.

**Step 1 — Launch in the background:**
```bash
bun scripts/run-generate.ts --concurrency 3
```
Run this with `run_in_background: true`. The script immediately prints startup info (PID, log file path, unmatched count) and then streams all subprocess output.

**Step 2 — Check in periodically (every 10–20 min):**
```bash
# Structured summary (fastest — parses status.json)
bun scripts/run-generate.ts --status

# Recent output (last 40 lines of the live log)
tail -n 40 logs/generate-<ts>.log
```
`--status` output:
```
Phase:       running
Progress:    120/359 (33%) — 115 stored, 3 skipped, 2 perm-failed, 4 retrying
Avg/poem:    18.4s
Remaining:   43m 54s
Last output: 2026-03-01T10:42:11Z (2m ago)
Alerts:      none
Log file:    logs/generate-20260301T100000Z.log
```

**Step 3 — Interpret alerts:**

The script writes structured alerts to `logs/generate-status.json` in real time. An agent should act on them immediately:

| Alert | Meaning | Action |
|---|---|---|
| `balance_exhausted` | DeepSeek returned 402 on at least one poem | Top up at [platform.deepseek.com](https://platform.deepseek.com). Re-run when topped up — unmatched poems are retried automatically. |
| `high_failure_rate` | >50% of processed poems are permanently failing | Check `DEEPSEEK_API_KEY` is set correctly in `packages/ai-gen/.env`. Inspect recent failure reasons: `tail -n 80 logs/generate-<ts>.log` |
| `hang_warning` | No output for >10 min | DeepSeek can legitimately hold connections this long under high load. Verify the process is still alive: `kill -0 <pid>`. If it has exited, the report file will have been written. |

**Step 4 — On completion:**

The wrapper writes a final report to `logs/generate-report-<ts>.json` containing: progress totals, assembly result, all alerts, DB validation counts (humanPoems, aiPoems, aiPoemsWithParent, unmatchedHuman, totalDuels), and a `nextSteps` array. Read it to determine whether to re-run or proceed to validation:

```bash
cat logs/generate-report-<ts>.json
```

If `unmatchedHuman > 0` the script includes it in `nextSteps` with the exact re-run command. Re-running is always safe — `fetchUnmatchedHumanPoems` is idempotent and will not reprocess already-stored poems.

**Expected outputs:**
- ~359 AI poems stored, each with `parent_poem_id` and `poem_topics` copied from the parent.
- ~718 minimum API calls (1 generation + 1 verification per poem); up to 9× more on persistent failures.
- Duel assembly runs automatically post-generation. Expected: ~359 new duels.
- DeepSeek context caching reduces system-prompt input costs by ~90% after the first call.

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
8. Run ai-gen full generation — ▶ Ready (`bun scripts/run-generate.ts --concurrency 3`)
9. Validate AI counterparts and duel assembly — ⏸ Pending step 8

Step 8 is unblocked: DeepSeek migration complete (`3fc74f1`, review `ca090d7`). See Phase 3 → Full Run Activation for pre-run checks, expected outputs, and troubleshooting. LOC re-scrape can be done independently via [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md).
