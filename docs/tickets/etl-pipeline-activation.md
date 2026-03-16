# [TASK] ETL Pipeline Activation — Full Data Run

**Date:** 2026-02-28
**Status:** Mostly Complete
**Priority:** High
**Assignee:** —
**Labels:** `etl`, `scraper`, `ai-gen`, `pipeline`

**Children:**
- [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md) — Improve LOC 180 scraper to avoid 429 throttling
- [`ai-gen-deepseek-migration.md`](ai-gen-deepseek-migration.md) — Migrate AI generation from Gemini to DeepSeek

## Context

The ETL pipeline pre-flight is complete (see `etl-pipeline-preflight.md`). The scraper orchestration script (`scripts/run-scrape.ts`), ETL environment configuration, and pipeline observability are all in place. The database currently holds 2 seed poems and 2 duels with no AI counterparts linked via `parent_poem_id`.

This ticket covers the full live activation: scraping all sources, running the ETL pipeline to load human poems, then running `@sanctuary/ai-gen` to generate AI counterparts and assemble duels. The ETL pipeline and AI generation are strictly separate processes — ETL must complete fully before AI generation begins.

## Phase 1: Scrape All Sources ⚠️ Partial (LOC blocked — see notes)

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

**LOC re-scrape attempts (2026-03-02):**

Three re-scrape attempts were made after implementing the improved rate limiter (commit `1c2a69d`). All three failed due to a long-duration IP-level WAF block on LOC's servers:

| Attempt | Result | Cause |
|---|---|---|
| 1 (concurrency=1, minDelay=4s, baseDelay=15s) | ~52 poems, ≥170 threshold failed | WAF blocks IP after ~52 requests; max backoff 19s (old) insufficient |
| 2 (+ list page retry) | 0 poems — list page 429 immediately | IP ban still active from attempt 1 |
| 3 (waited 33 min from first 429) | 0 poems — list page 429 through all 4 retries | IP ban persisting >40 minutes |

**Current LOC scraper state (commit `1c2a69d`):** concurrency=1, minDelay=4s, baseDelay=15s per-poem, 90s minimum circuit-breaker on any 429, list page has retry with same 90s circuit-breaker. The code is ready — the LOC re-scrape is blocked only by the IP ban, which expires after an unknown duration (observed: >40 min per session).

**To re-run LOC when ready:**
```bash
# Re-scrape LOC only (wait until IP ban has expired — ideally 24h after last attempt)
bun scripts/run-scrape.ts --sources loc-180

# Then re-run ETL to load new poems (upsert-safe — existing poems are not duplicated)
pnpm --filter @sanctuary/etl run pipeline --include-non-pd
```

Phase 3 generation proceeded without the additional LOC poems. The LOC re-scrape and subsequent ETL+generation pass can be done independently when the IP block clears.

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

## Phase 3: AI Poem Generation ✅ Complete

**Prerequisite:** Phase 2 must be fully complete. The ETL pipeline and AI generation are separate processes — never run concurrently against the same database.

**Required env:** `DEEPSEEK_API_KEY` must be set in `packages/ai-gen/.env`. See `packages/ai-gen/.env.example`.

> **Note:** The Gemini → DeepSeek migration is complete (commits `3fc74f1`, `ca090d7`). `GEMINI_API_KEY` is no longer required.

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

> **Agent note:** Before running, ensure `pnpm install` has been run. The `openai` package must be present in the pnpm store — it was found missing on 2026-03-02 due to store corruption/sync drift, causing an immediate 100% failure rate (all 355 poems failed at 0ms). Run `pnpm install` to restore it before any generation attempt.

### Full Run Activation

**DB state after full generation (2026-03-02):**

| Table | Count | Notes |
|---|---|---|
| `poems` WHERE `type = 'HUMAN'` | **364** | Unchanged — 362 from ETL + 2 pre-existing seeds |
| `poems` WHERE `type = 'AI'` | **358** | 2 pre-existing seeds (no `parent_poem_id`) + 356 with `parent_poem_id` |
| `poems` WHERE `type = 'AI' AND parent_poem_id IS NOT NULL` | **356** | AI counterparts linked to human poems |
| Unmatched human poems | **8** | Permanently failed during generation (JSON parse / line count) |
| `duels` | **4,616** | Assembled across multiple runs |

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
| `high_failure_rate` | >50% of processed poems are permanently failing | Check `DEEPSEEK_API_KEY` is set correctly in `packages/ai-gen/.env`. Also run `pnpm install` to ensure `openai` package is present. Inspect recent failure reasons: `tail -n 80 logs/generate-<ts>.log` |
| `hang_warning` | No output for >10 min | DeepSeek can legitimately hold connections this long under high load. Verify the process is still alive: `kill -0 <pid>`. If it has exited, the report file will have been written. |

**Step 4 — On completion:**

The wrapper writes a final report to `logs/generate-report-<ts>.json` containing: progress totals, assembly result, all alerts, DB validation counts (humanPoems, aiPoems, aiPoemsWithParent, unmatchedHuman, totalDuels), and a `nextSteps` array. Read it to determine whether to re-run or proceed to validation:

```bash
cat logs/generate-report-<ts>.json
```

If `unmatchedHuman > 0` the script includes it in `nextSteps` with the exact re-run command. Re-running is always safe — `fetchUnmatchedHumanPoems` is idempotent and will not reprocess already-stored poems.

> **Known issue:** The wrapper script (`scripts/run-generate.ts`) cannot import `@libsql/client` from the root context, so the pre-flight and post-run DB validation sections produce a `ResolveMessage: Cannot find module '@libsql/client'` warning. This does not affect generation or duel assembly — both run inside `@sanctuary/ai-gen` which resolves the package correctly. The `dbValidation` field in the report will be `null`.

**Expected outputs:**
- ~352 AI poems stored, each with `parent_poem_id` and `poem_topics` copied from the parent.
- ~718 minimum API calls (1 generation + 1 verification per poem); up to 9× more on persistent failures.
- Duel assembly runs automatically post-generation. Expected: ~352 new duels.
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

**Bug found and fixed during full run (2026-03-02):**
4. `pnpm` store out of sync — `openai` package missing from `node_modules/.pnpm/`, causing immediate 100% generation failure at 0ms elapsed (dynamic `import('openai')` fails; rejected Promise is cached, all subsequent poems fail instantly). Fix: `pnpm install`.

**Actual results (batch run — 5 poems, 2026-03-01):**
- 5/5 AI poems stored ✓
- Rate limiter triggered (37s of 86s total wall time on rate-limit wait) ✓
- Retry queue: 1 poem hit 429, retried successfully ✓
- Duel assembly: 0 duels (topic backfill bug — fixed before full run)

**Actual results (full run — 352 poems, 2026-03-02):**
- **344/352 AI poems stored** (97.7% success rate)
- 8 permanently failed (JSON parse errors / line count out of range)
- Duration: ~69 minutes
- **3,193 new duels assembled** (4,616 total in DB)
- Alerts: none

### Phase 3.1 — Fix Permanently Failed Poems ✅ Complete

7 of the 8 permanently failed poems were covered by the `fix-long-poems` script (see [`fix-long-poems.md`](fix-long-poems.md)). Root cause: DeepSeek truncates JSON output when the input poem exceeds ~4,000 chars (average successful poem: ~1,125 chars). The fix deleted 2 Gutenberg editorial artefacts and split 5 long poems into ≤4,000-char parts. The 8th failed poem succeeded on retry during the subsequent generation run.

**Script bug fixed during execution (2026-03-03):** The original `fix-long-poems.ts` had three issues that required fixes before the script could run cleanly:
1. **FK cascade missing** — `deleteOriginal` and the original-deletion block in `insertSplitPoems` did not delete referencing `duels` rows before the `poems` delete, causing `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`. Fixed by pre-fetching referencing duel IDs and cascading through `featured_duels` → `votes` → `duels` in the transaction.
2. **All-`\n\n` poem format** — Halloween and the Ballad of Reading Gaol were stored with `\n\n` between every individual line (no `\n` within stanzas), making the split algorithm cut mid-stanza. Fixed by adding `splitAtRomanSections` (Ballad: 6-line stanzas within sections I–VI) and `splitByFixedLineCount` (Halloween: 9-line stanzas), detected from the content format.
3. **Overly strict LLM prompt** — The verification prompt judged thematic completeness rather than structural integrity, causing false-positive INVALID results for Emerson's blank-verse poems. Fixed by revising the prompt to check sentence-level and line-level structural integrity only.

**Actual part counts (fixed algorithm):**

| Poem | Expected | Actual | Notes |
|---|---|---|---|
| The Ballad of Reading Gaol (Oscar Wilde) | 6 | **8** | Cantos III and IV oversized → each split into 2 sub-parts at stanza boundaries |
| MAY-DAY (Ralph Waldo Emerson) | 5 | 5 | ✓ |
| THE ADIRONDACS (Ralph Waldo Emerson) | 5 | 5 | ✓ |
| MONADNOC (Ralph Waldo Emerson) | 5 | 5 | ✓ |
| Halloween (Robert Burns) | 2 | 2 | ✓ |

Total new HUMAN part-poems: **25** (not 23)

**DB state after run (2026-03-03):**

```sql
-- 7 originals must be gone (actual: 0 rows) ✓
SELECT count(*) FROM poems
WHERE id LIKE 'd87091e153a9%' OR id LIKE 'f399fdc5e1ab%'
   OR id LIKE '19176bc9d632%' OR id LIKE 'b45e1e960ad8%'
   OR id LIKE 'c8d1c4ef3331%' OR id LIKE '92273a10aba0%'
   OR id LIKE 'f49974a9f0b2%';

-- 25 new part-poems present as HUMAN type (actual: 25 rows) ✓
SELECT title, author FROM poems
WHERE type = 'HUMAN' AND (
  title LIKE 'The Ballad of Reading Gaol (%)'
  OR title LIKE 'MAY-DAY (%)'
  OR title LIKE 'THE ADIRONDACS (%)'
  OR title LIKE 'MONADNOC (%)'
  OR title LIKE 'Halloween (%)'
);
-- Actual: Ballad ×8, MAY-DAY ×5, ADIRONDACS ×5, MONADNOC ×5, Halloween ×2
```

**Generation results (2026-03-03):**
- **25/25 AI counterparts stored** (100% success rate)
- Duration: ~9.5 minutes
- **431 new duels assembled**
- 8th previously-failed poem also succeeded on this retry run

```sql
-- AI poems with parent_poem_id (actual: 382 = 356 + 25 new + 1 retry success) ✓
SELECT count(*) FROM poems WHERE type = 'AI' AND parent_poem_id IS NOT NULL;

-- Total duels (actual: 4,964 = 4,616 − 89 cascaded + 431 new + 6 from 8th poem) ✓
SELECT count(*) FROM duels;
```

## Execution Order

1. ~~Run scraper (`scripts/run-scrape.ts`)~~ — ✅ Done (389 poems; LOC partial — see Phase 1 notes)
2. ~~Validate scraper output (file existence, non-empty)~~ — ✅ Done
3. ~~Run ETL dry-run (`--dry-run --include-non-pd`)~~ — ✅ Done
4. ~~Run ETL for real (`--include-non-pd`)~~ — ✅ Done (362 poems loaded)
5. ~~Validate DB state (poem counts, topic associations)~~ — ✅ Done (364 HUMAN, 809 topic associations)
6. ~~Implement ai-gen rate limiting and retry queue changes~~ — ✅ Done
7. ~~Run ai-gen with `--limit 5` to validate~~ — ✅ Done (5/5 stored; 3 bugs fixed during run)
8. ~~Run ai-gen full generation~~ — ✅ Done (344/352 stored, 8 perm-failed, 4,616 duels)
9. ~~Validate AI counterparts and duel assembly~~ — ✅ Done (356 AI poems with parent, 4,616 duels, spot-check passed)
10. ~~Dry-run `fix-long-poems` and verify part counts~~ — ✅ Done (2 DELETE + 5 SPLIT; algorithm fixed to handle all-`\n\n` format and LLM prompt revised for structural verification)
11. ~~Execute `fix-long-poems` and confirm DB state~~ — ✅ Done (0 originals remaining; 25 new part-poems inserted: Ballad×8, MAY-DAY×5, ADIRONDACS×5, MONADNOC×5, Halloween×2; 89 stale duels cascaded)
12. ~~Re-run generation for the ~25 new part-poems~~ — ✅ Done (25/25 stored, 431 new duels, 382 total AI poems with parent; 8th previously-failed poem also succeeded on retry)

**Remaining work:**
- LOC re-scrape: the IP-ban blocker from 2026-03-02 was resolved by the WAF bypass implementation (Playwright + JSON API, shipped 2026-03-02 through 2026-03-14 — see `loc-scraper-waf-bypass.md`). The actual re-scrape run, ETL reload, and AI gen for ~115 new poems has not been confirmed as executed.
  ```bash
  bun scripts/run-scrape.ts --sources loc-180
  pnpm --filter @sanctuary/etl run pipeline --include-non-pd
  bun scripts/run-generate.ts --concurrency 3
  ```
