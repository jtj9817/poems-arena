# Review: ETL Phase 3 - Stage 4 Load Implementation

**Commit:** `adcb459`
**Date:** 2026-02-21
**Reviewer:** Gemini CLI

## Context

Implementation Plan - Phase 3: ETL Pipeline (`conductor/tracks/etl_pipeline_20260220/plan.md`)

## Findings

### 1. [Critical] Unsafe Access to `provenances[0]`

**File:** `packages/etl/src/stages/04-load.ts`
**Location:** `loadPoem` function

The code assumes `poem.provenances` is never empty:

```typescript
const primaryProvenance = poem.provenances[0];
// ...
source: primaryProvenance.source, // Throws if undefined
```

If `poem.provenances` is empty, this will crash the ETL process. While previous stages might filter this, the `load` stage should be robust or explicitly validate this assumption.

**Recommendation:**
Add a guard clause or validation:

```typescript
if (!poem.provenances.length) {
  throw new Error(`Poem ${poemId} has no provenance`);
}
```

### 2. [High] Performance Bottleneck: Sequential Transactions

**File:** `packages/etl/src/stages/04-load.ts`
**Location:** `runLoadStage` loop

The current implementation processes each poem in a separate database transaction within a synchronous loop:

```typescript
for await (const line of rl) {
  // ...
  await loadPoem(db, poem); // Opens/commits transaction per line
}
```

For large datasets (e.g., Gutenberg), this will be significantly slower than necessary due to transaction overhead and fsync latency.

**Recommendation:**
Implement batch processing. Accumulate `TagPoem` objects into a buffer (e.g., size 500) and commit them in a single transaction.

### 3. [Medium] ID Generation Collision Risk

**File:** `packages/etl/src/utils/id-gen.ts`
**Location:** `generatePoemId` / `generateScrapeSourceId`

The hashing function uses `:` as a delimiter after normalization:

```typescript
hashToId(`poem:${normalize(title)}:${normalize(author)}`);
```

Since `normalize` preserves punctuation (only trims and collapses whitespace), a collision is possible if the title/author contains the delimiter at the boundary.

- Title: "Foo:", Author: "Bar" -> "poem:foo::bar"
- Title: "Foo", Author: ":Bar" -> "poem:foo::bar"

**Recommendation:**
Use a delimiter that cannot exist in the input (e.g., `\0` null character) or length-prefix the segments.

### 4. [Low] Batch Topic Upsert

**File:** `packages/etl/src/stages/04-load.ts`
**Location:** `upsertTopics`

Topics are inserted one by one in a loop. While `CANONICAL_TOPICS` is small (20), it is more efficient to perform a single batch insert if the ORM/Driver supports it.

---

## Phase 0 & 1 Commit Audit

Below are the **implementation commits** (code edits only, excluding docs/conductor-only commits) mapped to each phase since `30cfeac`:

### Phase 0: Inputs, Contracts, and Defaults

**a9adc03** — fix(scraper): align writer output contract

- Updated `packages/scraper/src/utils/writer.ts` to resolve `outputDir` before writing so `writeScrapedPoems` returns an absolute path
- Updated `packages/scraper/src/utils/writer.test.ts` for OS-independent path assertions
- Documented filesystem-safe timestamp format in `packages/etl/INPUT_CONTRACT.md` as part of ETL input contract

**9620a14** — feat(etl): scaffold @sanctuary/etl package with CLI skeleton and data layout

- Created `packages/etl/package.json` with `@sanctuary/etl` workspace package definition
- Created `packages/etl/tsconfig.json` mirroring scraper configuration
- Created `packages/etl/src/index.ts` — CLI entry point with `parseCliArgs()` supporting `--stage`, `--input-dir`, `--work-dir`, `--dry-run`, `--limit`, `--include-non-pd` flags
- Created `packages/etl/src/index.test.ts` with 8 CLI parsing tests (all passing)
- Established working directory structure: `packages/etl/data/` with stage output directories `01-clean/`, `02-dedup/`, `03-tag/`
- Default input directory: `packages/scraper/data/raw`
- Default work directory: `packages/etl/data`

---

### Phase 1: Setup & Data Access Layer

**0e3a618** — feat(etl): install runtime dependencies and add zod validation test

- Added runtime dependencies to `packages/etl/package.json`: `drizzle-orm`, `@libsql/client`, `zod`, `fast-glob`, `dotenv`
- Created `packages/etl/src/config.test.ts` with 3 tests validating Zod usage for stage configuration and inter-stage schema checks
- Matched dependency versions with `apps/api` for compatibility (`drizzle-orm ^0.38.0`, `@libsql/client ^0.14.0`, `zod ^3.23.0`)

**d693342** — feat(db): extract shared Drizzle schema into @sanctuary/db package

- Created new workspace package `packages/db` (`@sanctuary/db`) with sub-path exports (`./schema`, `./config`, `./client`)
- Created `packages/db/src/schema.ts` — Drizzle table definitions (poems, topics, poem_topics, scrape_sources)
- Created `packages/db/src/config.ts` — `resolveDbConfig()` function for database configuration resolution
- Created `packages/db/src/client.ts` — `createDb()` factory for database client instantiation
- Created `packages/db/src/index.ts` — re-exports for clean imports
- Created test files: `packages/db/src/schema.test.ts` (6 tests), `packages/db/src/config.test.ts` (5 tests), `packages/db/src/client.test.ts` (5 tests)
- Modified `apps/api/src/db/schema.ts` to re-export from `@sanctuary/db/schema`
- Modified `apps/api/src/db/config.ts` to re-export from `@sanctuary/db/config`
- Modified `apps/api/src/db/client.ts` to use `createDb` and `resolveDbConfig` from `@sanctuary/db`
- Modified `apps/api/package.json` to add `@sanctuary/db` workspace dependency
- Modified `packages/etl/package.json` to add `@sanctuary/db` workspace dependency
- Fixed TypeScript issues: corrected `bun-types` reference to `@types/bun`, resolved self-referential FK type error

**f442fc5** — docs(etl): add .env.example documenting required env vars and CLI defaults

- Created `packages/etl/.env.example` documenting required environment variables:
  - `LIBSQL_URL` — database URL (with `file:./local.db` dev-friendly shorthand)
  - `LIBSQL_AGILIQUILL_TOKEN` — authentication token for Turso/LibSQL
- Documented all CLI flag defaults as comments for operator reference

---

### Excluded Commits (Non-Implementation)

The following commits were excluded as they are documentation, conductor plan updates, chores, or unrelated fixes:

- `148e044`, `3a1bb64`, `f7bd2a3`, `d5c6b03`, `da43a4d`, `1cebcc1` — conductor plan task/phase completion markers
- `42970fc` — conductor checkpoint with verification report (meta)
- `52c14d8`, `180305d` — verification script creation and relocation (chores)
- `f512650` — .gitignore/.prettierignore updates for Playwright (config)
- `1e930c8` — e2e Playwright config fix (unrelated to ETL pipeline)
- `189ff7b` — dependency vulnerability remediation (meta)
- `14f370e` — path traversal security fix in scraper writer (unrelated to Phase 0/1 ETL work)

## Phase 2: Stage 1 - Clean is complete. Here's a summary of what was implemented:

---

Summary

Files created

packages/etl/src/stages/01-clean.ts — Stage implementation

- ScrapedPoemSchema — Zod schema validating raw scraper input at runtime (no @sanctuary/scraper dependency needed)
- CleanPoemSchema / CleanPoem — typed, validated output contract
- stripHtml(text) — removes HTML tags and decodes named, decimal, and hex HTML entities
- normalizeWhitespace(text) — CRLF→LF, tabs→space, multi-space collapse, per-line trim, stanza-break normalization (\n\n\n+ → \n\n)
- normalizeText(text) — composes: Unicode NFC → stripHtml → normalizeWhitespace
- countNonEmptyLines(content) — counts lines with non-whitespace content
- validateAndClean(raw) — validates + normalizes a single poem; returns null (logged, no halt) for missing title/content or < 4 non-empty lines
- runCleanStage(config) — discovers _.json/_.ndjson via fast-glob, honours --limit and --dry-run, writes NDJSON to --work-dir/01-clean/, returns { read, valid, skipped,
  written }

packages/etl/src/stages/01-clean.test.ts — 32 unit tests across stripHtml, normalizeWhitespace, countNonEmptyLines, and validateAndClean

Phase 2 is complete and checkpointed. Here's a summary of what was done:

**Checkpoint: `732c71e`** — Phase 2: Stage 1 - Clean (`01-clean.ts`)

The verification script at `scripts/verify-etl-phase-2.ts` ran 7 checks, all passing:

| #   | Check                                                       | Result |
| --- | ----------------------------------------------------------- | ------ |
| 1   | ETL automated test suite (43 tests)                         | PASS   |
| 2   | JSON input → NDJSON output + title normalization            | PASS   |
| 3   | Output NDJSON passes CleanPoem schema; provenance preserved | PASS   |
| 4   | NDJSON input processing                                     | PASS   |
| 5   | Invalid poems skipped without halting                       | PASS   |
| 6   | Dry-run mode writes no files                                | PASS   |
| 7   | `@sanctuary/etl` typecheck                                  | PASS   |

**Phase 3: Stage 2 - Deduplicate (`02-dedup.ts`)**.

### Summary of Changes

1. **New Zod Schemas**: Created `DedupPoemSchema` and `DedupProvenanceSchema` in `02-dedup.ts` to reflect the deduplicated output structure (which retains multiple `provenances` for each poem).
2. **Normalization & Matching Logic**:
   - `normalizeDedupKey`: Performs unicode normalization (NFD, stripping diacritics), case-folding, removes punctuation, collapses whitespace, and strips leading articles ("the", "a", "an").
   - `isFuzzyMatch`: Evaluates identical normalized keys, suffix variants (e.g. "... excerpt" vs base), and uses a configurable Levenshtein distance strategy to catch minor typos (up to 20% edit distance threshold for longer strings) without inadvertently merging short strings.
3. **Priority & Resolution**:
   - Mapped `SOURCE_PRIORITY` to match project specs (`poets.org` > `poetry-foundation` > `loc-180` > `gutenberg`).
   - `resolveDuplicates`: Takes a group of poems, picks the highest-priority canonical text, aggregates all their unique provenance metadata, and outputs a single `DedupPoem`.
4. **IO Integration & Orchestration**:
   - Reads inputs sequentially from `--work-dir/01-clean/*.ndjson` using streaming.
   - Evaluates poems via `authorGroups` to reduce matching bounds, runs `titleKey` fuzzy grouping logic, and resolves duplicates.
   - Streams unique merged poems to an `--work-dir/02-dedup/dedup-[timestamp].ndjson` file.
   - Wired `runDedupStage` execution into the primary `packages/etl/src/index.ts` CLI switch logic.
5. **Testing**:
   - Wrote 55 passing unit tests within `02-dedup.test.ts` to strictly verify exact-matches, trailing

## Phase 4

## Commit `d1ffd72` — `feat(etl): implement Stage 3 - Tag with canonical topic mapping`

### New file: `packages/etl/src/mappings/theme-to-topic.ts`

The core mapping module. Exports everything the tag stage and (later) the load stage need:

- **`CANONICAL_TOPICS`** — the 20 topic IDs from Plan 001 (`nature`, `mortality`, `love`, … `rebellion`), as a `const` tuple so Zod can use it as an enum constraint.
- **`TOPIC_LABELS`** — display-name record (`'the-sea' → 'The Sea'`, etc.) for upserting into the `topics` DB table in Stage 4.
- **`MAX_TOPICS = 3`** — explicit cap, documented as a named constant.
- **`THEME_TO_TOPIC`** — ~80-entry map from raw scraper theme strings (lower-cased for lookup) to one or more canonical topic IDs. Covers all four scrapers: poets.org subjects, Poetry Foundation subjects, LOC 180, and Gutenberg manual tags. Implements all Plan 001 examples (`"Weather" → nature`, `"Death" → mortality + grief`, `"Romance" → love`, `"Oceans" → the-sea`).
- **`KEYWORD_TOPICS`** — ordered fallback list of 20 entries (one per topic), each with a set of characteristic words. Uses `\b` word-boundary regex so `"art"` doesn't match `"heart"`.
- **`mapThemesToTopics(themes)`** — case-insensitive theme lookup, deduplicates via a `Set`, does not cap.
- **`extractTopicsFromKeywords(title, content)`** — scans poem text for whole-word keyword matches, deduplicates, does not cap.
- **`assignTopics(themes, title, content)`** — orchestrates both: tries theme mapping first; only falls back to keyword extraction if theme mapping returns nothing. Caps at `MAX_TOPICS`. Returns `{ topics, usedFallback }`.

### New file: `packages/etl/src/stages/03-tag.ts`

The stage implementation:

- **`TagPoemSchema`** — extends `DedupPoemSchema` with `topics: z.array(z.enum(CANONICAL_TOPICS)).max(3)`. The `.max(3)` makes the cap a hard schema contract, not just a runtime convention.
- **`runTagStage(config)`** — reads all `*.ndjson` files from `02-dedup/`, parses each line as `DedupPoem`, calls `assignTopics`, logs a `[tag] Keyword fallback for "…"` message when fallback fires, writes `TagPoem` records to `03-tag/tag-<timestamp>.ndjson`. Respects `--limit` and `--dry-run`. Returns `{ read, tagged, fallback, written }`.

### New file: `packages/etl/src/stages/03-tag.test.ts`

45 new unit tests (suite grew from 55 → 100):

- **`CANONICAL_TOPICS`** — Exact count (20), all IDs from Plan 001 present
- **`TOPIC_LABELS`** — Every canonical topic has a non-empty label
- **`MAX_TOPICS`** — Value is 3
- **`mapThemesToTopics`** — Plan 001 explicit examples, case-insensitivity, unknown themes, multi-theme aggregation, deduplication
- **`extractTopicsFromKeywords`** — Per-topic keyword hits, case-insensitivity, empty-text guard, title+content combination
- **`assignTopics`** — Theme-first path, fallback path, `usedFallback` flag semantics, cap enforcement, deduplication, no bleed from keyword fallback when themes match
- **`TagPoemSchema`** — Valid poem, empty topics, >3 topics rejected, invalid topic ID rejected, missing `topics` field rejected

### Modified file: `packages/etl/src/index.ts`

Added `import { runTagStage }` and wired it into the CLI switch so `--stage tag` and `--stage all` both invoke the new stage, printing the summary line on completion.

## Phase 5: Stage 4 - Load (`04-load.ts`) + CLI Orchestration — Commit Audit

Below are the **implementation commits** since `adcb459`:

---

**adcb459** — feat(etl): implement Stage 4 - Load with deterministic IDs and CLI orchestration

### 1. Deterministic ID Generation (`src/utils/id-gen.ts`)

- **Created `generatePoemId(title, author)`**: SHA-256 hash (truncated to 12 hex chars) of normalized `title:author` pair; implements case-folding, trim, and whitespace collapse for idempotent upserts
- **Created `generateScrapeSourceId(poemId, source, sourceUrl)`**: Same 12-char hash strategy for `(poemId, source, sourceUrl)` provenance triples
- Uses `Bun.CryptoHasher('sha256')` for native hashing performance

### 2. Stage 4 Load Implementation (`src/stages/04-load.ts`)

- **`upsertTopics(db)`**: Upserts all 20 canonical topics from `CANONICAL_TOPICS`/`TOPIC_LABELS` using `INSERT … ON CONFLICT DO UPDATE`
- **`loadPoem(db, TagPoem)`**: Transactional per-poem loader:
  - Upserts `poems` table with `type = 'HUMAN'`, deterministic ID, and primary provenance metadata
  - Refreshes `poem_topics` via delete-then-insert pattern (clears stale associations, inserts current topic IDs)
  - Upserts `scrape_sources` provenance rows with `scrapedAt`, `isPublicDomain` flags
- **`runLoadStage(config, db)`**: Stage orchestrator:
  - Reads NDJSON from `--work-dir/03-tag/`
  - Filters non-public-domain poems by default (respects `--include-non-pd` override)
  - Honors `--dry-run` and `--limit` flags
  - Returns `LoadStageSummary` with read/loaded/skipped counts and topics upserted

### 3. CLI Orchestration Updates (`src/index.ts`)

- Added `load` to the `Stage` union type
- Wired `runLoadStage` into the main pipeline with database client initialization (`resolveDbConfig`, `createDb` from `@sanctuary/db`)
- Stage now runs in sequence when `--stage all` (clean → dedup → tag → load) or standalone via `--stage load`
- CLI outputs progress and summary for load stage (read, loaded, skippedNonPd, topicsUpserted)

### 4. Test Coverage

- **`src/utils/id-gen.test.ts`** (11 tests): Verifies deterministic ID generation, case/whitespace insensitivity, uniqueness across different inputs
- **`src/stages/04-load.test.ts`** (17 tests): Mock-based tests verifying:
  - All 20 canonical topics are upserted
  - Poem upsert with proper conflict resolution
  - `poem_topics` refresh (delete + insert pattern)
  - `scrape_sources` provenance upsert
  - Public-domain filtering (default exclusion + `--include-non-pd` override)
  - Dry-run behavior (no DB writes)
  - Idempotent behavior on repeated runs

---

**Test Results**: Total suite: 128 tests, 0 failures, 0 typecheck errors
