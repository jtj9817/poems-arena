# Review: ETL Phase 2 (Stage 1 - Clean)

**Date:** 2026-02-21
**Commit:** 7d98cb9
**Reviewer:** Gemini (Principal Software Engineer)
**Status:** Resolved
**Priority:** High

## Summary

The commit implements the `01-clean` stage of the ETL pipeline, including Zod schemas, text normalization logic, and the file processing runner. While the logic is largely sound and well-tested, there are significant concerns regarding scalability (memory usage), robustness (error handling during parsing), and data quality (entity decoding).

## Findings

### 1. [HIGH] Potential Out-of-Memory (OOM) Risk in `runCleanStage`

**Location:** `packages/etl/src/stages/01-clean.ts`

The current implementation accumulates all valid `CleanPoem` objects in the `cleanPoems` array and generates a single monolithic NDJSON string before writing to disk.

```typescript
// Current implementation
const cleanPoems: CleanPoem[] = [];
// ... (loop pushes to array)
const ndjson = cleanPoems.map((p) => JSON.stringify(p)).join('
');
await writeFile(outFile, ndjson, 'utf-8');
```

**Impact:** For large datasets (e.g., Gutenberg dumps or large scrapes), this will likely cause the process to crash with an Out-of-Memory error.
**Recommendation:** Implement stream-based writing or chunked processing. Open a file handle using `fs.open` or `fs.createWriteStream` and write records incrementally as they are validated.

### 2. [MEDIUM] Fragile NDJSON Parsing

**Location:** `packages/etl/src/stages/01-clean.ts`

The NDJSON parsing logic inside `runCleanStage` is synchronous and lacks error handling for malformed lines.

```typescript
records = raw
  .split('
')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line) as unknown); // <--- Crash if line is invalid JSON
```

**Impact:** A single malformed line in an input file will crash the entire ETL pipeline.
**Recommendation:** Wrap `JSON.parse` in a `try-catch` block (or `safeJsonParse` helper). Log a warning for malformed lines and skip them, rather than halting execution.

### 3. [MEDIUM] Limited HTML Entity Decoding

**Location:** `packages/etl/src/stages/01-clean.ts`

The `stripHtml` function relies on a hardcoded, sparse map (`HTML_ENTITIES`) containing only ~15 entities.

```typescript
const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  // ... (missing many entities like eacute, ntilde, etc.)
};
```

**Impact:** If the source text contains named entities not in this list (common in scraped content, e.g., `&eacute;` for 'é'), they will be preserved in the output, violating the "Clean" contract which expects normalized text.
**Recommendation:** Use a comprehensive entity decoding library (like `he`) or a significantly expanded map.

### 4. [LOW] Potential RangeError in Entity Decoding

**Location:** `packages/etl/src/stages/01-clean.ts`

The hex entity decoder uses `String.fromCodePoint` without checking if the parsed integer is a valid code point range.

```typescript
return String.fromCodePoint(parseInt(hex, 16));
```

**Impact:** Malicious or corrupted input with extremely large hex values could cause a `RangeError` and crash the pipeline.
**Recommendation:** Add a try-catch block or a range check before calling `String.fromCodePoint`.

## Context

### Phase 0 & 1 Commit Audit

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

## Resolution

**Status:** Resolved
**Verified on:** 2026-02-21

All four findings from this review were confirmed as addressed in `packages/etl/src/stages/01-clean.ts`.

### Finding 1 — OOM Risk: Resolved

The `runCleanStage` function no longer accumulates poems in a `cleanPoems` array. It opens a `FileHandle` lazily on the first valid record (`fs.promises.open(outFile, 'a')`) and writes each record incrementally inside the processing loop. The `finally` block ensures the handle is closed regardless of early termination:

```typescript
// 01-clean.ts (lines 254–259)
if (!config.dryRun) {
  if (!fileHandle) {
    fileHandle = await fs.promises.open(outFile, 'a');
  }
  await fileHandle.write(JSON.stringify(cleaned) + '\n');
  summary.written++;
}
```

### Finding 2 — Fragile NDJSON Parsing: Resolved

`JSON.parse` is now wrapped in a `try-catch` for both the NDJSON and JSON array paths. Malformed lines log a warning and are counted as skipped rather than crashing the pipeline:

```typescript
// 01-clean.ts (lines 236–242)
try {
  record = JSON.parse(trimmed);
} catch {
  summary.skipped++;
  console.warn(`[clean] Skipping malformed JSON line in ${basename(filePath)}`);
  continue;
}
```

### Finding 3 — Limited HTML Entity Decoding: Resolved

The hand-rolled `HTML_ENTITIES` map has been replaced with the `he` library. `stripHtml` now calls `he.decode(result)` which provides comprehensive coverage of all named, decimal, and hex HTML entities:

```typescript
// 01-clean.ts (line 73)
result = he.decode(result);
```

### Finding 4 — RangeError in Entity Decoding: Resolved

The hand-rolled hex entity decoder that called `String.fromCodePoint(parseInt(hex, 16))` without a range check has been removed entirely. Entity decoding is now delegated to `he.decode()`, which handles edge cases internally.

---

## Phase 2: Stage 1 - Clean is complete. Here's a summary of what was implemented:

---

Summary

Files created

packages/etl/src/stages/01-clean.ts — Stage implementation

- ScrapedPoemSchema — Zod schema validating raw scraper input at runtime (no @sanctuary/scraper dependency needed)
- CleanPoemSchema / CleanPoem — typed, validated output contract
- stripHtml(text) — removes HTML tags and decodes named, decimal, and hex HTML entities
- normalizeWhitespace(text) — CRLF→LF, tabs→space, multi-space collapse, per-line trim, stanza-break normalization (

* →

)

- normalizeText(text) — composes: Unicode NFC → stripHtml → normalizeWhitespace
- countNonEmptyLines(content) — counts lines with non-whitespace content
- validateAndClean(raw) — validates + normalizes a single poem; returns null (logged, no halt) for missing title/content or < 4 non-empty lines
- runCleanStage(config) — discovers _.json/_.ndjson via fast-glob, honours --limit and --dry-run, writes NDJSON to --work-dir/01-clean/, returns { read, valid, skipped,
  written }

packages/etl/src/stages/01-clean.test.ts — 32 unit tests across stripHtml, normalizeWhitespace, countNonEmptyLines, and validateAndClean
