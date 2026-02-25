# Specification: Phase 3 - ETL Pipeline

This track implements Phase 3 ("ETL") from `docs/plans/001-data-pipeline-plan.md` (Section 5: ETL Pipeline).

## 1. Overview

The ETL pipeline processes scraped poems into database-ready, topic-tagged, de-duplicated rows with provenance. It runs as a CLI in a new workspace package: `packages/etl`.

Stages (sequential):

1. Clean (`01-clean.ts`)
2. Deduplicate (`02-dedup.ts`)
3. Tag (`03-tag.ts`)
4. Load (`04-load.ts`)

## 2. Package Structure

The implementation should follow the structure described in `docs/plans/001-data-pipeline-plan.md`:

```text
packages/etl/
├── src/
│   ├── index.ts                # CLI entry (runs stages)
│   ├── stages/
│   │   ├── 01-clean.ts
│   │   ├── 02-dedup.ts
│   │   ├── 03-tag.ts
│   │   └── 04-load.ts
│   ├── mappings/
│   │   └── theme-to-topic.ts   # Raw theme -> canonical topic mapping
│   └── utils/
│       └── id-gen.ts           # Deterministic IDs for idempotency
├── package.json
└── tsconfig.json
```

## 3. Scope and Assumptions

- **Primary input**: JSON produced by the scraper, stored on disk (default: `packages/scraper/data/raw`).
- **Sources**: The source priority list includes Poetry Foundation, but current scraping may be deprioritized; ETL must not assume any specific source is present.
- **Copyright**: Default behavior is to load only poems flagged `isPublicDomain = true`. Non-PD requires an explicit override.

## 4. Canonical Topics (Contract)

The ETL pipeline must only assign topic IDs from this canonical set (copied from `docs/plans/001-data-pipeline-plan.md`):

```ts
export const CANONICAL_TOPICS = [
  'nature',
  'mortality',
  'love',
  'time',
  'loss',
  'identity',
  'war',
  'faith',
  'beauty',
  'solitude',
  'memory',
  'childhood',
  'the-sea',
  'night',
  'grief',
  'desire',
  'home',
  'myth',
  'dreams',
  'rebellion',
] as const;
```

## 5. Inputs and Outputs

### 5.1 Input format (`ScrapedPoem`)

ETL consumes `ScrapedPoem` objects (file-backed):

- Required fields: `sourceId`, `source`, `sourceUrl`, `title`, `author`, `content`, `themes`, `isPublicDomain`, `scrapedAt`
- Optional fields: `year`, `form`

Supported file formats:

- `*.json`: an array of `ScrapedPoem` objects
- `*.ndjson`: one `ScrapedPoem` per line

### 5.2 Stage output conventions

Each stage writes to `--work-dir/<stage>/` so individual stages can be re-run and the pipeline can resume:

- `01-clean/` -> input to `02-dedup`
- `02-dedup/` -> input to `03-tag`
- `03-tag/` -> input to `04-load`

The output format must be consistent across stages (either JSON or NDJSON), with runtime validation at each stage boundary.

## 6. Functional Requirements (Stage-by-Stage)

### 6.1 Stage 1: Clean (`01-clean.ts`)

Input: raw `ScrapedPoem` records.

Processing:

- Normalize Unicode (NFC) for `title`, `author`, and `content`.
- Strip residual markup/entities defensively (even if the scraper returns plain text).
- Normalize whitespace:
  - Single spaces within a line.
  - `\\n` between lines.
  - `\\n\\n` between stanzas.
- Trim leading/trailing whitespace from `title`, `author`, and `content`.

Validation:

- Reject if missing `title` or `content`.
- Reject if fewer than 4 non-empty lines.
- Log and skip invalid poems (do not halt the run).

Output:

- A validated and normalized set of poems (no topic tags yet).
- Preserve provenance fields required later: `sourceId`, `source`, `sourceUrl`, `scrapedAt`, `isPublicDomain`.

### 6.2 Stage 2: Deduplicate (`02-dedup.ts`)

Input: cleaned poems from Stage 1.

Dedup keying:

- Primary grouping by normalized `(title, author)` key:
  - NFC, case-folded, whitespace collapsed, punctuation collapsed.
- Fuzzy fallback (required by Plan 001):
  - If two poems have identical normalized authors and "near-equal" titles, treat as duplicates.
  - The exact fuzzy rule must be explicit in code and testable (example: string similarity threshold plus a minimum title length).

Conflict resolution (source priority):

1. `poets.org` (highest)
2. `poetry-foundation`
3. `loc-180`
4. `gutenberg` (lowest)

Merge behavior:

- Select a single canonical poem text/title/year/form as the "winner" for downstream tagging/loading.
- Retain all unique provenance entries across duplicates for insertion into `scrape_sources`.

Output:

- A canonical poem list, one row per unique poem, plus merged provenance.

### 6.3 Stage 3: Tag (`03-tag.ts`)

Input: deduplicated poems from Stage 2.

Primary strategy (theme mapping):

- Map source themes -> canonical topic IDs using a mapping table (`src/mappings/theme-to-topic.ts`).
- Mapping is case-insensitive and source-agnostic.

Fallback strategy (keyword analysis):

- If a poem has no mapped topics, analyze `title` + `content` using a keyword map per canonical topic.
- Log when fallback is used so mapping gaps can be iterated.

Constraints:

- Only assign topics from `CANONICAL_TOPICS`.
- Deduplicate topic IDs.
- Cap the maximum topics per poem (explicitly choose a max; default recommendation: 3).

Output:

- Poems enriched with `topicIds: string[]`.

### 6.4 Stage 4: Load (`04-load.ts`)

Input: tagged poems from Stage 3.

Database:

- Connect to LibSQL (Turso or local file-backed LibSQL) via Drizzle.
- Required env vars: `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`.

Operations (transactional):

1. Upsert topics into `topics`:
   - Topic IDs must match canonical topic IDs.
   - Topic labels are derived display labels (e.g., title case).
2. Upsert poems into `poems`:
   - `type = 'HUMAN'`.
   - Store `source`, `source_url`, `form`, and `year` where available.
   - Use deterministic IDs to make idempotency cheap and reliable (Plan 001: `src/utils/id-gen.ts`).
3. Refresh `poem_topics`:
   - Ensure links match the current `topicIds` set for the poem.
4. Insert provenance into `scrape_sources`:
   - One row per unique `(poem_id, source, source_url)`.
   - Include `is_public_domain` and preserve `scraped_at` when available (optional `raw_html` passthrough if it is part of the scraper dump contract).

Idempotency:

- Re-running the pipeline on the same input must not create duplicate poems, topics, join rows, or provenance rows.

Default filtering:

- Do not load non-public-domain poems unless the user passes an explicit override flag (e.g., `--include-non-pd`).

## 7. CLI Requirements

Entry point: `packages/etl/src/index.ts`.

- Run full pipeline: `pnpm --filter @sanctuary/etl run pipeline`
- Run an individual stage: `... run pipeline --stage clean|dedup|tag|load`
- Core flags:
  - `--input-dir <path>` (default: `packages/scraper/data/raw`)
  - `--work-dir <path>` (default: `packages/etl/data`)
  - `--dry-run` (no DB writes)
  - `--limit <n>` (process only first N poems, for iteration)
  - `--include-non-pd` (opt-in to loading non-public-domain poems)

## 8. Non-Functional Requirements

- Performance: handle thousands of poems via batching and efficient file IO.
- Logging: print per-stage counts (read, processed, skipped, written, loaded).
- Type safety: validate inter-stage payloads at runtime (Zod) and use shared TS types.

## 9. Acceptance Criteria

- [ ] `packages/etl` exists as `@sanctuary/etl` and is wired into the pnpm workspace.
- [ ] `pnpm --filter @sanctuary/etl run pipeline` runs all stages end-to-end.
- [ ] Clean stage normalizes content and skips invalid poems without halting.
- [ ] Dedup stage resolves conflicts by the defined source priority and retains provenance.
- [ ] Tag stage assigns only canonical topics and uses keyword fallback when needed.
- [ ] Load stage inserts/updates data into the configured LibSQL database (Turso or local) and is idempotent on re-run.
