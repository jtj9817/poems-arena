# Specification: Phase 3 - ETL Pipeline

## 1. Overview

This track implements the Extract, Transform, Load (ETL) pipeline for processing scraped poems into the Classicist's Sanctuary database. The pipeline will reside in a new package `packages/etl` and consist of four sequential stages: Clean, Deduplicate, Tag, and Load.

## 2. Functional Requirements

### 2.1 Package Structure (`packages/etl`)

- Create a new workspace package `@sanctuary/etl`.
- Dependencies: `drizzle-orm`, `@libsql/client`, `fast-glob`, `zod` (for validation).
- Entry point: `src/index.ts` (CLI).

### 2.2 Stage 1: Clean (`01-clean.ts`)

- **Input**: Raw JSON files from `packages/scraper/data/raw`.
- **Processing**: - Normalize Unicode (NFC). - Strip HTML entities and residual markup. - Normalize whitespace: single space between words, `
` between lines, `

` between stanzas. - Trim leading/trailing whitespace from titles and content.

- **Validation**:
  - Reject poems with fewer than 4 lines.
  - Reject poems with missing title or content.
  - **Error Handling**: Log validation failures and skip the poem (do not halt).

### 2.3 Stage 2: Deduplicate (`02-dedup.ts`)

- **Input**: Cleaned poems from Stage 1.
- **Processing**:
  - Group poems by normalized `(lowercase(title), lowercase(author))`.
  - **Conflict Resolution**: If duplicates exist across sources, prioritize in this order:
    1. Poets.org (Highest)
    2. Poetry Foundation
    3. LOC Poetry 180
    4. Project Gutenberg (Lowest)
- **Output**: A single canonical version for each unique poem.

### 2.4 Stage 3: Tag (`03-tag.ts`)

- **Input**: Deduplicated poems from Stage 2.
- **Processing**:
  - **Primary Strategy**: Map raw source themes to the `CANONICAL_TOPICS` list (e.g., "Weather" -> "nature").
  - **Fallback Strategy (Keyword Analysis)**: If no source themes map to a canonical topic, analyze the poem's title and content for keywords associated with canonical topics.
  - **Constraint**: Only assign topics from the defined `CANONICAL_TOPICS` list.
- **Output**: Poems enriched with an array of canonical topic IDs.

### 2.5 Stage 4: Load (`04-load.ts`)

- **Input**: Tagged poems from Stage 3.
- **Processing**:
  - **Database**: Connect to LibSQL (Turso) via Drizzle ORM.
  - **Operations (Transactional)**:
    1. **Upsert Topics**: Ensure all canonical topics exist in the `topics` table.
    2. **Upsert Poems**: Insert or Update poems in the `poems` table (match on Title + Author).
    3. **Update Associations**: Refresh `poem_topics` links.
    4. **Track Provenance**: Record the source in `scrape_sources`.
- **Idempotency**: Re-running the pipeline should update existing records without creating duplicates.

### 2.6 CLI Interface

- Expose a command to run the full pipeline: `pnpm --filter @sanctuary/etl run pipeline`.
- Support running individual stages for debugging: `... run pipeline --stage clean`, etc.

## 3. Non-Functional Requirements

- **Performance**: Use efficient file I/O (streams or batch processing) to handle large datasets.
- **Logging**: Provide clear console output for each stage, including counts of processed, skipped, and error items.
- **Type Safety**: Use Zod or similar for runtime validation of the JSON structure between stages.

## 4. Acceptance Criteria

- [ ] The `packages/etl` package is created and integrated into the workspace.
- [ ] The `clean` stage correctly normalizes whitespace and filters invalid poems.
- [ ] The `dedup` stage correctly prioritizes sources (e.g., Poets.org version replaces Gutenberg version).
- [ ] The `tag` stage correctly maps themes and falls back to keyword analysis for untagged poems.
- [ ] The `load` stage successfully inserts data into a local SQLite database file.
- [ ] Re-running the pipeline on the same data does not result in duplicate database rows.
- [ ] `pnpm --filter @sanctuary/etl run pipeline` executes all stages successfully.
