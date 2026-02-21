# Implementation Plan - Phase 3: ETL Pipeline

This track implements Phase 3 ("ETL") from `docs/plans/001-data-pipeline-plan.md` (see Section 5: ETL Pipeline).

## Phase 0: Inputs, Contracts, and Defaults

- [~] Task: Confirm scraper output contract (input to ETL)
  - [ ] Define a default input location: `packages/scraper/data/raw/`.
  - [ ] Define supported file formats: `*.json` (array of `ScrapedPoem`) and/or `*.ndjson` (one `ScrapedPoem` per line).
  - [ ] Ensure the record schema matches the project contract: `sourceId`, `source`, `sourceUrl`, `title`, `author`, `year`, `content`, `themes`, `form`, `isPublicDomain`, `scrapedAt`.
  - [ ] Decide and document the canonical way to generate these raw dumps for ETL runs (CLI/script, output naming, and where checkpoints live).
- [ ] Task: Decide ETL working directory layout and IO conventions
  - [ ] Default a working directory (suggested): `packages/etl/data/`.
  - [ ] Define stage outputs (suggested): `01-clean/`, `02-dedup/`, `03-tag/` (inputs to `04-load`).
  - [ ] Ensure CLI supports `--input-dir` and `--work-dir` overrides (local, CI, and ad-hoc runs).

## Phase 1: Setup & Data Access Layer

- [ ] Task: Scaffold `packages/etl` package
  - [ ] Create `packages/etl` directory with `package.json` and `tsconfig.json`.
  - [ ] Install dependencies: `drizzle-orm`, `@libsql/client`, `zod`, `fast-glob`, `dotenv`.
  - [ ] Add scripts: `test` (bun), `pipeline` (CLI entry), and `typecheck`.
- [ ] Task: Shared schema access (API + ETL)
  - [ ] Extract Drizzle schema currently in `apps/api/src/db/schema.ts` into a shared package (`packages/shared` or a new `packages/db`) so ETL can depend on it without importing from an app workspace.
  - [ ] Update `apps/api` to import schema from the shared location.
  - [ ] Configure `packages/etl` to import the shared schema and (if needed) a shared `db` client factory.
- [ ] Task: Environment + configuration
  - [ ] Document required env vars for ETL: `LIBSQL_URL`, `LIBSQL_AGILIQUILL_TOKEN` (plus any local/dev defaults).
  - [ ] Add explicit defaults for CLI flags (input/work dirs, stage selection, dry-run).
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Setup & Data Access Layer' (Protocol in workflow.md)

## Phase 2: Stage 1 - Clean (`01-clean.ts`)

- [ ] Task: Define the stage contract (input/output types)
  - [ ] Validate input as `ScrapedPoem` (Zod schema) and emit a normalized `CleanPoem`.
  - [ ] Decide how to represent/retain provenance fields needed later (`sourceId`, `sourceUrl`, `isPublicDomain`, `scrapedAt`).
- [ ] Task: Implement normalization + validation rules (aligned with Plan 001)
  - [ ] Unicode normalize (NFC).
  - [ ] Strip residual markup/entities (defensive, even if scraper already produced plain text).
  - [ ] Whitespace normalization: single spaces within lines, `\\n` between lines, `\\n\\n` between stanzas.
  - [ ] Trim title/content/author.
  - [ ] Validate: reject poems with missing title/content or fewer than 4 non-empty lines; log and skip.
- [ ] Task: Implement file discovery and output writing
  - [ ] Input: read all matching files from `--input-dir` (default: `packages/scraper/data/raw`).
  - [ ] Output: write normalized poems to `--work-dir/01-clean` in a consistent format (JSON or NDJSON).
  - [ ] Emit stage summary: counts for read, valid, skipped, and output.
- [ ] Task: Tests (`01-clean.test.ts`)
  - [ ] Whitespace + stanza normalization.
  - [ ] Minimum-line validation and skip behavior (does not halt the run).
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Extract & Transform Stages' (Protocol in workflow.md)

## Phase 3: Stage 2 - Deduplicate (`02-dedup.ts`)

- [ ] Task: Make dedup keys explicit (exact + fuzzy)
  - [ ] Define a normalization function for title/author keys (case-folding, punctuation collapse, whitespace collapse, Unicode NFC).
  - [ ] Implement a fuzzy title match fallback for near-duplicates (as required by Plan 001) and document the exact threshold/rule.
- [ ] Task: Source priority and merge behavior
  - [ ] Source priority: `poets.org` > `poetry-foundation` > `loc-180` > `gutenberg`.
  - [ ] When duplicates exist, choose a single canonical poem text but retain all unique provenance entries for loading into `scrape_sources`.
- [ ] Task: IO + logging
  - [ ] Input: `--work-dir/01-clean`.
  - [ ] Output: `--work-dir/02-dedup`.
  - [ ] Emit dedup report: number of groups, duplicates dropped, and selected sources.
- [ ] Task: Tests (`02-dedup.test.ts`)
  - [ ] Exact-match grouping and priority resolution.
  - [ ] Fuzzy-match grouping for small title variants.

## Phase 4: Stage 3 - Tag (`03-tag.ts`)

- [ ] Task: Canonical topic set and mapping tables
  - [ ] Implement `CANONICAL_TOPICS` exactly as defined in `docs/plans/001-data-pipeline-plan.md`.
  - [ ] Add `src/mappings/theme-to-topic.ts` for raw theme -> canonical topic mapping (case-insensitive, source-agnostic).
  - [ ] Add a keyword fallback map (title/content) for poems without mappable themes.
- [ ] Task: Topic assignment rules
  - [ ] Only assign topic IDs from `CANONICAL_TOPICS`.
  - [ ] Deduplicate topic IDs and cap the assigned list (explicitly choose a maximum, e.g., 3) to avoid noise.
  - [ ] Log when fallback keyword tagging is used.
- [ ] Task: IO + logging
  - [ ] Input: `--work-dir/02-dedup`.
  - [ ] Output: `--work-dir/03-tag`.
- [ ] Task: Tests (`03-tag.test.ts`)
  - [ ] Theme mapping correctness.
  - [ ] Keyword fallback behavior for untagged poems.

## Phase 5: Stage 4 - Load (`04-load.ts`) + CLI Orchestration

- [ ] Task: Deterministic IDs and upsert semantics
  - [ ] Implement deterministic ID generation (Plan 001 suggests `src/utils/id-gen.ts`) for `poems.id` and `scrape_sources.id`.
  - [ ] Make idempotency explicit: repeated runs update existing rows and do not create duplicates.
- [ ] Task: Transactional DB load (LibSQL/Turso via Drizzle)
  - [ ] Upsert canonical topics into `topics` (IDs are canonical topic IDs; labels are display labels).
  - [ ] Insert/update poems (`type = 'HUMAN'`, set `source`, `source_url`, `form`, `year`).
  - [ ] Refresh `poem_topics` associations (delete + insert or upsert join rows).
  - [ ] Insert `scrape_sources` provenance rows for each poem (including `is_public_domain`, `scraped_at`, and optional `raw_html` if present in the input contract).
  - [ ] Default behavior: only load `isPublicDomain = true` poems; support an explicit override flag for non-PD data (for manual review workflows).
- [ ] Task: CLI entry point (`src/index.ts`)
  - [ ] Support: `--stage clean|dedup|tag|load|all`, `--dry-run`, `--input-dir`, `--work-dir`, `--limit`, `--include-non-pd`.
  - [ ] Ensure each stage can run independently and can resume from prior stage outputs.
- [ ] Task: Tests (`04-load.test.ts`)
  - [ ] Mock DB client and verify the expected upsert/association calls are made.
  - [ ] Verify idempotent behavior for a repeated run (no duplicate inserts).
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Load Stage & CLI Orchestration' (Protocol in workflow.md)

## Phase 6: Regression & Quality Gate

- [ ] Task: Coverage and regression verification
  - [ ] Execute `pnpm --filter @sanctuary/etl test`.
  - [ ] Execute `pnpm lint` and `pnpm format:check`.
- [ ] Task: Regression checklist (explicit)
  - [ ] Run full pipeline twice on the same raw dump; verify counts are stable and DB rows do not multiply.
  - [ ] Verify source priority behavior across all sources: `poets.org` > `poetry-foundation` > `loc-180` > `gutenberg`.
  - [ ] Verify poems with no theme tags still receive topics via keyword fallback.
  - [ ] Verify non-PD poems are excluded by default and only included with an explicit override.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 7: Documentation

- [ ] Task: Documentation update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 3 completion.
  - [ ] Add `packages/etl/README.md` with usage, flags, and IO conventions.
  - [ ] Update project `README.md` to include ETL pipeline commands.
