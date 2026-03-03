# [TASK] Fix Long Poems — Clean, Split, and Re-insert

**Date:** 2026-03-02
**Status:** Complete
**Priority:** High
**Assignee:** —
**Labels:** `etl`, `ai-gen`, `data-quality`, `pipeline`

**Linked To:**
- Parent Ticket: [`etl-pipeline-activation.md`](etl-pipeline-activation.md)

## Context

7 human poems permanently failed AI counterpart generation because DeepSeek truncated its JSON output mid-response when asked to generate against very long poems. These poems were identified in the `etl-pipeline-activation.md` Phase 3 results ("8 permanently failed — JSON parse errors / line count out of range").

Investigation revealed two distinct categories:

- **2 non-poems** — Gutenberg editorial artefacts that should never have passed the ETL clean stage:
  - `d87091e153a9` — `INDEX OF FIRST LINES` (Ralph Waldo Emerson)
  - `f399fdc5e1ab` — `FRAGMENTS ON THE POET AND THE POETIC GIFT` (Ralph Waldo Emerson)

- **5 genuinely long poems** — Poems that are valid but far exceed the ~1,125-char average that DeepSeek handles reliably. The shortest failure was 8,101 chars (7×+ the average):
  - `19176bc9d632` — *The Ballad of Reading Gaol* (Oscar Wilde, 21,523 chars)
  - `b45e1e960ad8` — *MAY-DAY* (Ralph Waldo Emerson, ~17k chars)
  - `c8d1c4ef3331` — *THE ADIRONDACS* (Ralph Waldo Emerson, ~15k chars)
  - `92273a10aba0` — *MONADNOC* (Ralph Waldo Emerson, ~13k chars)
  - `f49974a9f0b2` — *Halloween* (Robert Burns, 8,101 chars)

## Implementation

A one-off fixup script `packages/etl/src/fix-long-poems.ts` was implemented with four phases:

### Step 1 — Delete Non-Poems
Delete `poem_topics`, `scrape_sources`, and `poems` rows for the two editorial artefacts in a single transaction.

### Step 2 — Clean and Split Long Poems
Each long poem's content is split on double-newlines into stanzas after stripping:
1. Standalone Roman numeral section headers (e.g., Wilde's `I`–`VI` dividers).
2. Single-line ALL-CAPS editorial headers ≤ 80 chars (e.g., Emerson's `A JOURNAL`).

Cleaned stanzas are packed greedily into parts under `MAX_PART_CHARS = 4000`. Any trailing part with < 20 lines is merged into the previous part to avoid orphan fragments.

**Expected split results:**

| Poem | Parts |
|---|---|
| The Ballad of Reading Gaol | 6 |
| MAY-DAY | 5 |
| THE ADIRONDACS | 5 |
| MONADNOC | 5 |
| Halloween | 2 (3rd tail merged into Part II) |

Total new HUMAN poems after split: **23**

### Step 3 — LLM Verification (Claude Haiku 4.5)
Each split part is verified by `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk` before any DB writes. The model checks that each part begins and ends at clean stanza boundaries with no truncation artefacts. If any part of a poem fails, all parts for that poem are skipped and the original is left intact for manual inspection.

Calls are sequential (23 total).

### Step 4 — DB Write
For each poem that passes verification, all 23 parts are written in a single transaction:
- New `poems` rows with deterministic SHA-256 IDs, titles suffixed `(I)`, `(II)`, etc.
- `poem_topics` copied from the original.
- `scrape_sources` copied from the original.
- Original poem deleted at the end of the same transaction.

## Files Changed

| File | Change |
|---|---|
| `packages/etl/src/fix-long-poems.ts` | Created — fixup script |
| `packages/etl/package.json` | Added `@anthropic-ai/sdk ^0.39.0` dep + `fix-long-poems` script |
| `packages/etl/.env.example` | Added `ANTHROPIC_API_KEY` entry |

## Running the Script

```bash
# Add ANTHROPIC_API_KEY to packages/etl/.env first

# Dry-run — preview all planned changes (reads DB, no writes, no LLM calls)
pnpm --filter @sanctuary/etl run fix-long-poems -- --dry-run

# Execute — runs LLM verification then writes to DB
pnpm --filter @sanctuary/etl run fix-long-poems

# After the script completes, generate AI counterparts for the ~23 new part-poems
bun scripts/run-generate.ts --concurrency 3
```

## Acceptance Criteria

- [x] `fix-long-poems.ts` implemented with dry-run support
- [x] `@anthropic-ai/sdk` added to `packages/etl/package.json`
- [x] `ANTHROPIC_API_KEY` documented in `.env.example`
- [x] Dry-run confirms 2 deletes + 5 splits matching expected part counts
- [x] LLM verification passes for all 25 parts (Ballad produces 8 parts, not 6, due to stanza-aware section splitting; 3 fixes required before all parts passed — see Phase 3.1 notes in etl-pipeline-activation.md)
- [x] DB state after run: 2 editorial artefacts gone; 5 original long poems replaced by 25 part-poems (Ballad×8, MAY-DAY×5, ADIRONDACS×5, MONADNOC×5, Halloween×2)
- [x] `bun scripts/run-generate.ts --concurrency 3` generates AI counterparts for the 25 new poems (25/25, 0 failures)
- [x] Duel assembly produces 431 new duels from the new part-poems
