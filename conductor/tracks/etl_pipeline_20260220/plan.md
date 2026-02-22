# Implementation Plan - Phase 3: ETL Pipeline

This track implements Phase 3 ("ETL") from `docs/plans/001-data-pipeline-plan.md` (see Section 5: ETL Pipeline).

## Phase 0: Inputs, Contracts, and Defaults

- [x] Task: Confirm scraper output contract (input to ETL) `30cfeac`
  - [x] Define a default input location: `packages/scraper/data/raw/`.
  - [x] Define supported file formats: `*.json` (array of `ScrapedPoem`) and/or `*.ndjson` (one `ScrapedPoem` per line).
  - [x] Ensure the record schema matches the project contract: `sourceId`, `source`, `sourceUrl`, `title`, `author`, `year`, `content`, `themes`, `form`, `isPublicDomain`, `scrapedAt`.
  - [x] Decide and document the canonical way to generate these raw dumps for ETL runs (CLI/script, output naming, and where checkpoints live).
- [x] Task: Decide ETL working directory layout and IO conventions `9620a14`
  - [x] Default a working directory (suggested): `packages/etl/data/`.
  - [x] Define stage outputs (suggested): `01-clean/`, `02-dedup/`, `03-tag/` (inputs to `04-load`).
  - [x] Ensure CLI supports `--input-dir` and `--work-dir` overrides (local, CI, and ad-hoc runs).

## Phase 1: Setup & Data Access Layer [checkpoint: 42970fc]

- [x] Task: Scaffold `packages/etl` package — 0e3a618
  - [x] Create `packages/etl` directory with `package.json` and `tsconfig.json`.
  - [x] Install dependencies: `drizzle-orm`, `@libsql/client`, `zod`, `fast-glob`, `dotenv`.
  - [x] Add scripts: `test` (bun), `pipeline` (CLI entry), and `typecheck`.
- [x] Task: Shared schema access (API + ETL) — d693342
  - [x] Extract Drizzle schema currently in `apps/api/src/db/schema.ts` into a shared package (`packages/shared` or a new `packages/db`) so ETL can depend on it without importing from an app workspace.
  - [x] Update `apps/api` to import schema from the shared location.
  - [x] Configure `packages/etl` to import the shared schema and (if needed) a shared `db` client factory.
- [x] Task: Environment + configuration — f442fc5
  - [x] Document required env vars for ETL: `LIBSQL_URL`, `LIBSQL_AGILIQUILL_TOKEN` (plus any local/dev defaults).
  - [x] Add explicit defaults for CLI flags (input/work dirs, stage selection, dry-run).
- [x] Task: Conductor - User Manual Verification 'Phase 1: Setup & Data Access Layer' (Protocol in workflow.md)

## Phase 2: Stage 1 - Clean (`01-clean.ts`) [checkpoint: 732c71e]

- [x] Task: Define the stage contract (input/output types) `7d98cb9`
  - [x] Validate input as `ScrapedPoem` (Zod schema) and emit a normalized `CleanPoem`.
  - [x] Decide how to represent/retain provenance fields needed later (`sourceId`, `sourceUrl`, `isPublicDomain`, `scrapedAt`).
- [x] Task: Implement normalization + validation rules (aligned with Plan 001) `7d98cb9`
  - [x] Unicode normalize (NFC).
  - [x] Strip residual markup/entities (defensive, even if scraper already produced plain text).
  - [x] Whitespace normalization: single spaces within lines, `\\n` between lines, `\\n\\n` between stanzas.
  - [x] Trim title/content/author.
  - [x] Validate: reject poems with missing title/content or fewer than 4 non-empty lines; log and skip.
- [x] Task: Implement file discovery and output writing `7d98cb9`
  - [x] Input: read all matching files from `--input-dir` (default: `packages/scraper/data/raw`).
  - [x] Output: write normalized poems to `--work-dir/01-clean` in a consistent format (JSON or NDJSON).
  - [x] Emit stage summary: counts for read, valid, skipped, and output.
- [x] Task: Tests (`01-clean.test.ts`) `7d98cb9`
  - [x] Whitespace + stanza normalization.
  - [x] Minimum-line validation and skip behavior (does not halt the run).
- [x] Task: Conductor - User Manual Verification 'Phase 2: Extract & Transform Stages' (Protocol in workflow.md) `732c71e`

## Phase 3: Stage 2 - Deduplicate (`02-dedup.ts`) [checkpoint: 1a95e77]

- [x] Task: Make dedup keys explicit (exact + fuzzy)
  - [x] Define a normalization function for title/author keys (case-folding, punctuation collapse, whitespace collapse, Unicode NFC).
  - [x] Implement a fuzzy title match fallback for near-duplicates (as required by Plan 001) and document the exact threshold/rule.
- [x] Task: Source priority and merge behavior
  - [x] Source priority: `poets.org` > `poetry-foundation` > `loc-180` > `gutenberg`.
  - [x] When duplicates exist, choose a single canonical poem text but retain all unique provenance entries for loading into `scrape_sources`.
- [x] Task: IO + logging
  - [x] Input: `--work-dir/01-clean`.
  - [x] Output: `--work-dir/02-dedup`.
  - [x] Emit dedup report: number of groups, duplicates dropped, and selected sources.
- [x] Task: Tests (`02-dedup.test.ts`)
  - [x] Exact-match grouping and priority resolution.
  - [x] Fuzzy-match grouping for small title variants.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Stage 2 - Deduplicate' (Protocol in workflow.md) `1a95e77`

## Phase 4: Stage 3 - Tag (`03-tag.ts`) [checkpoint: 3eb4e59]

- [x] Task: Canonical topic set and mapping tables `d1ffd72`
  - [x] Implement `CANONICAL_TOPICS` exactly as defined in `docs/plans/001-data-pipeline-plan.md`.
  - [x] Add `src/mappings/theme-to-topic.ts` for raw theme -> canonical topic mapping (case-insensitive, source-agnostic).
  - [x] Add a keyword fallback map (title/content) for poems without mappable themes.
- [x] Task: Topic assignment rules `d1ffd72`
  - [x] Only assign topic IDs from `CANONICAL_TOPICS`.
  - [x] Deduplicate topic IDs and cap the assigned list (explicitly choose a maximum, e.g., 3) to avoid noise.
  - [x] Log when fallback keyword tagging is used.
- [x] Task: IO + logging `d1ffd72`
  - [x] Input: `--work-dir/02-dedup`.
  - [x] Output: `--work-dir/03-tag`.
- [x] Task: Tests (`03-tag.test.ts`) `d1ffd72`
  - [x] Theme mapping correctness.
  - [x] Keyword fallback behavior for untagged poems.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Stage 3 - Tag' (Protocol in workflow.md) `3eb4e59`

## Phase 5: Stage 4 - Load (`04-load.ts`) + CLI Orchestration

- [x] Task: Deterministic IDs and upsert semantics `adcb459`
  - [x] Implement deterministic ID generation (Plan 001 suggests `src/utils/id-gen.ts`) for `poems.id` and `scrape_sources.id`.
  - [x] Make idempotency explicit: repeated runs update existing rows and do not create duplicates.
- [x] Task: Transactional DB load (LibSQL/Turso via Drizzle) `adcb459`
  - [x] Upsert canonical topics into `topics` (IDs are canonical topic IDs; labels are display labels).
  - [x] Insert/update poems (`type = 'HUMAN'`, set `source`, `source_url`, `form`, `year`).
  - [x] Refresh `poem_topics` associations (delete + insert or upsert join rows).
  - [x] Insert `scrape_sources` provenance rows for each poem (including `is_public_domain`, `scraped_at`, and optional `raw_html` if present in the input contract).
  - [x] Default behavior: only load `isPublicDomain = true` poems; support an explicit override flag for non-PD data (for manual review workflows).
- [x] Task: CLI entry point (`src/index.ts`) `adcb459`
  - [x] Support: `--stage clean|dedup|tag|load|all`, `--dry-run`, `--input-dir`, `--work-dir`, `--limit`, `--include-non-pd`.
  - [x] Ensure each stage can run independently and can resume from prior stage outputs.
- [x] Task: Tests (`04-load.test.ts`) `adcb459`
  - [x] Mock DB client and verify the expected upsert/association calls are made.
  - [x] Verify idempotent behavior for a repeated run (no duplicate inserts).
- [x] Task: Conductor - User Manual Verification 'Phase 3: Load Stage & CLI Orchestration' (Protocol in workflow.md) `bdb12a4`

## Phase 6: Regression & Quality Gate

- [x] Task: Coverage and regression verification
  - [x] Execute `pnpm --filter @sanctuary/etl test`.
  - [x] Execute `pnpm lint` and `pnpm format:check`.
- [x] Task: Regression checklist (explicit)
  - [x] Run full pipeline twice on the same raw dump; verify counts are stable and DB rows do not multiply.
  - [x] Verify source priority behavior across all sources: `poets.org` > `poetry-foundation` > `loc-180` > `gutenberg`.
  - [x] Verify poems with no theme tags still receive topics via keyword fallback.
  - [x] Verify non-PD poems are excluded by default and only included with an explicit override.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)
  - [x] Automation script: `scripts/verify-etl-phase-6.ts`.
  - [x] Shell wrapper: `scripts/run-manual-verification-phase-4.sh`.

## Phase 7: Documentation

- [ ] Task: Documentation update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 3 completion.
  - [ ] Add `packages/etl/README.md` with usage, flags, and IO conventions.
  - [ ] Update project `README.md` to include ETL pipeline commands.
