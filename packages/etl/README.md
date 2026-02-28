# @sanctuary/etl

ETL pipeline for the Classicist's Sanctuary. Cleans, deduplicates, tags, and loads scraped poems into the LibSQL (Turso) database.

---

## Overview

The pipeline runs as a CLI in four sequential stages:

| Stage           | File                     | Input                                 | Output                 |
| --------------- | ------------------------ | ------------------------------------- | ---------------------- |
| 1 — Clean       | `src/stages/01-clean.ts` | `--input-dir` (`*.json` / `*.ndjson`) | `--work-dir/01-clean/` |
| 2 — Deduplicate | `src/stages/02-dedup.ts` | `--work-dir/01-clean/`                | `--work-dir/02-dedup/` |
| 3 — Tag         | `src/stages/03-tag.ts`   | `--work-dir/02-dedup/`                | `--work-dir/03-tag/`   |
| 4 — Load        | `src/stages/04-load.ts`  | `--work-dir/03-tag/`                  | LibSQL database        |

Stages write intermediate NDJSON so each can be re-run independently and the pipeline can resume from any point.

---

## Quick Start

```bash
# 1. Copy and fill in credentials
cp packages/etl/.env.example packages/etl/.env

# 2. Run the full pipeline
pnpm --filter @sanctuary/etl run pipeline

# 3. Dry-run (no DB writes) with a sample of 50 poems
pnpm --filter @sanctuary/etl run pipeline --dry-run --limit 50
```

---

## CLI Flags

| Flag                 | Default                     | Description                                                   |
| -------------------- | --------------------------- | ------------------------------------------------------------- |
| `--stage <name>`     | `all`                       | Run a single stage: `clean`, `dedup`, `tag`, `load`, or `all` |
| `--input-dir <path>` | `packages/scraper/data/raw` | Directory containing raw scraper output (`*.json`)            |
| `--work-dir <path>`  | `packages/etl/data`         | Working directory for intermediate stage outputs              |
| `--dry-run`          | `false`                     | Skip all database writes (stages 1–3 still write files)       |
| `--limit <n>`        | _(none)_                    | Process only the first N poems (useful for iteration)         |
| `--include-non-pd`   | `false`                     | Load non-public-domain poems (default: public-domain only)    |

### Examples

```bash
# Run only the clean stage
pnpm --filter @sanctuary/etl run pipeline --stage clean

# Re-run from tag onward using existing dedup output
pnpm --filter @sanctuary/etl run pipeline --stage tag
pnpm --filter @sanctuary/etl run pipeline --stage load

# Point to a custom input directory
pnpm --filter @sanctuary/etl run pipeline --input-dir /tmp/raw-poems

# Include non-public-domain poems (review workflow)
pnpm --filter @sanctuary/etl run pipeline --include-non-pd
```

---

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable            | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `LIBSQL_URL`        | Turso database URL (`libsql://...`) or `file:./local.db` for a local SQLite file |
| `LIBSQL_AUTH_TOKEN` | Turso auth token (leave blank for local file-backed databases)                   |

Only the `load` stage reads environment variables. Stages 1–3 operate purely on the filesystem.

---

## Input Contract

The pipeline reads `ScrapedPoem` records produced by `@sanctuary/scraper`.

**Default input directory:** `packages/scraper/data/raw/`

**Supported file formats:**

- `*.json` — JSON array of `ScrapedPoem` objects
- `*.ndjson` — one `ScrapedPoem` per line

See [`INPUT_CONTRACT.md`](./INPUT_CONTRACT.md) for the full field reference and scraper output conventions.

---

## Stage Details

### Stage 1: Clean

- Unicode-normalizes (NFC) `title`, `author`, and `content`.
- Strips residual HTML markup and entities.
- Normalizes whitespace: single space within lines, `\n` between lines, `\n\n` between stanzas.
- Rejects poems with missing `title`/`content` or fewer than 4 non-empty lines (logs and skips; does not halt the run).

**Summary output:** `read`, `valid`, `skipped`, `written`

### Stage 2: Deduplicate

- Groups poems by normalized `(title, author)` key (NFC, case-folded, whitespace/punctuation collapsed).
- Fuzzy fallback: poems with identical normalized authors and near-equal titles (edit-distance threshold) are treated as duplicates.
- Source priority for conflict resolution: `poets.org` > `poetry-foundation` > `loc-180` > `gutenberg`.
- The winning poem text is kept; all unique provenance entries are merged for later loading into `scrape_sources`.

**Summary output:** `read`, `groups`, `duplicatesDropped`, `written`

### Stage 3: Tag

- Maps raw source `themes` to canonical topic IDs via `src/mappings/theme-to-topic.ts` (case-insensitive, source-agnostic).
- Falls back to keyword analysis of `title` + `content` when no themes map.
- Only assigns topics from the 20-item `CANONICAL_TOPICS` set.
- Deduplicates topic IDs and caps the result at 3 per poem.
- Logs when keyword fallback is used.

**Summary output:** `read`, `tagged`, `fallback`, `written`

### Stage 4: Load

All writes are transactional and idempotent — re-running the pipeline on the same input will not create duplicate rows.

Operations per run:

1. **Upsert all 20 canonical topics** into the `topics` table.
2. For each poem: **upsert into `poems`** (`type = 'HUMAN'`).
3. **Refresh `poem_topics`** associations (delete existing + insert current topic IDs).
4. **Upsert `scrape_sources`** provenance rows (one per unique `(poem_id, source, source_url)`).

Idempotency is guaranteed by deterministic SHA-256-based IDs (`src/utils/id-gen.ts`): the same `(title, author)` pair always produces the same `poem_id`.

**Summary output:** `read`, `loaded`, `skippedNonPd`, `topicsUpserted`

---

## Canonical Topics

The pipeline assigns topics from this fixed set:

```
nature · mortality · love · time · loss · identity · war · faith
beauty · solitude · memory · childhood · the-sea · night · grief
desire · home · myth · dreams · rebellion
```

Topic mapping and keyword rules live in `src/mappings/theme-to-topic.ts`.

---

## Working Directory Layout

```
packages/etl/data/
├── 01-clean/    # Output of Stage 1 (NDJSON)
├── 02-dedup/    # Output of Stage 2 (NDJSON)
└── 03-tag/      # Output of Stage 3 (NDJSON, input to Stage 4)
```

The `data/` directory is gitignored (only `.gitkeep` files are committed). Override with `--work-dir`.

---

## Internal Utilities

| File                  | Purpose                                                                              |
| --------------------- | ------------------------------------------------------------------------------------ |
| `src/logger.ts`       | Lightweight pipeline logger. Exports `stageStart`, `stageEnd`, `pipelineSummary`, and `formatElapsed`. Called by `src/index.ts` to print per-stage elapsed times and a final summary table. |
| `src/utils/id-gen.ts` | Deterministic SHA-256 poem ID generation used by the load stage for idempotency.    |

---

## Development

```bash
# Run all tests
pnpm --filter @sanctuary/etl test

# Type check
pnpm --filter @sanctuary/etl typecheck

# Run linter across the monorepo
pnpm lint
```

Tests live alongside source files (`*.test.ts`) and cover each stage's normalization, dedup, tagging, and load logic with a mocked DB client.
