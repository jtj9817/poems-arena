# Plan 001 — Data Pipeline: Scraper → ETL → AI Generation → Database

**Status:** In Progress (Scraper, E2E Infrastructure & ETL Pipeline Complete)
**Created:** 2026-02-19
**Updated:** 2026-02-21

---

## 1. Overview

The Classicist's Sanctuary needs a rich corpus of human poems and AI-generated counterparts to power its "blind taste test" duels. This plan covers:

1. **Schema evolution** — Extend the database to support scraping metadata, topic tagging, and provenance tracking
2. **Poem scraper** — Harvest human poems from four public sources
3. **ETL pipeline** — Clean, deduplicate, tag, and load scraped poems into the database
4. **AI poem generation service** — Generate matched AI counterparts for each human poem
5. **Duel assembly** — Automatically pair human + AI poems into duels by topic

---

## 2. Source Analysis

### 2.1 Poets.org (Primary — Richest metadata)

- **URL pattern:** `https://poets.org/poems?page={0..829}` (830 pages, ~20 poems/page ≈ 16,600 poems)
- **List page yields:** Title, Author, Year (in a `<table>`)
- **Detail page yields:** Full poem text, author bio link, themes (tags like "Romance", "Weather", "Public Domain")
- **URL for detail:** `https://poets.org/poem/{slug}`
- **Rate limiting:** Standard HTML pages, server-rendered. Respect `robots.txt`, add 1-2s delay between requests.
- **Filterable by:** Occasion, Theme, Form (dropdowns on list page)
- **Copyright note:** Many poems are marked "public domain" — only scrape those, or flag copyright status for filtering.

### 2.2 Poetry Foundation (Secondary — Filter-heavy)

- **URL pattern:** `https://www.poetryfoundation.org/poems/browse#subjects` with filter-based browsing
- **Structure:** Filter by Subjects, Occasions, Holidays, Poetic Terms, Emotions, Audiences
- **Detail pages:** `https://www.poetryfoundation.org/poems/{id}/{slug}`
- **Challenge:** JS-heavy rendering, may need Playwright for pagination. Filter interactions load content dynamically.
- **Copyright note:** Mixed — check per-poem licensing.

### 2.3 Library of Congress — Poetry 180

- **URL:** `https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/`
- **Structure:** Single page listing 180 poems curated by Billy Collins. Links to individual poem pages.
- **Yields:** Title, Author, Poem number (1–180)
- **Detail pages:** Individual LOC poem pages with full text.
- **Copyright note:** Curated for public/educational use; verify per-poem.

### 2.4 Project Gutenberg — Emerson's Poems

- **URL:** `https://www.gutenberg.org/files/12843/12843-h/12843-h.htm`
- **Structure:** Single HTML page containing the full "Poems by Ralph Waldo Emerson" (Household Edition). Poems separated by `<h2>`/`<h3>` headings.
- **Yields:** Title, Full text. Author is always "Ralph Waldo Emerson". Year range: 1867–1911 editions.
- **Copyright:** Public domain (Project Gutenberg).

---

## 3. Schema Evolution

### 3.1 Current Schema (unchanged tables)

```
poems:    id, title, content, author, type ('HUMAN'|'AI'), year
duels:    id, topic, poem_a_id, poem_b_id, created_at
votes:    id, duel_id, selected_poem_id, is_human, voted_at
```

### 3.2 New Tables

#### `topics`

Canonical topic/theme labels used for duel matching. Normalized from source tags.

```sql
CREATE TABLE topics (
  id         TEXT PRIMARY KEY,          -- e.g. 'nature', 'mortality', 'love'
  label      TEXT NOT NULL,             -- Display name: "Nature", "Mortality", "Love"
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

#### `poem_topics` (join table)

Many-to-many relationship between poems and topics.

```sql
CREATE TABLE poem_topics (
  poem_id  TEXT NOT NULL REFERENCES poems(id),
  topic_id TEXT NOT NULL REFERENCES topics(id),
  PRIMARY KEY (poem_id, topic_id)
);
```

#### `scrape_sources`

Track provenance of scraped poems for auditing, re-scraping, and deduplication.

```sql
CREATE TABLE scrape_sources (
  id          TEXT PRIMARY KEY,
  poem_id     TEXT NOT NULL REFERENCES poems(id),
  source      TEXT NOT NULL,           -- 'poets.org' | 'poetry-foundation' | 'loc-180' | 'gutenberg'
  source_url  TEXT NOT NULL,           -- Full URL of the poem page
  scraped_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  raw_html    TEXT,                    -- Optional: store raw HTML for reprocessing
  is_public_domain INTEGER NOT NULL DEFAULT 0
);
```

### 3.3 Schema Modifications to `poems`

Add columns to the existing `poems` table:

```sql
ALTER TABLE poems ADD COLUMN source TEXT;           -- 'poets.org' | 'ai-generated' | 'gutenberg' | etc.
ALTER TABLE poems ADD COLUMN source_url TEXT;        -- Original URL (null for AI)
ALTER TABLE poems ADD COLUMN form TEXT;              -- 'sonnet', 'ode', 'free-verse', etc.
ALTER TABLE poems ADD COLUMN prompt TEXT;            -- AI generation prompt (null for human)
ALTER TABLE poems ADD COLUMN parent_poem_id TEXT REFERENCES poems(id);  -- AI poem's human counterpart
```

### 3.4 Schema Modifications to `duels`

Link duels to the canonical topic:

```sql
ALTER TABLE duels ADD COLUMN topic_id TEXT REFERENCES topics(id);
```

The existing `topic` TEXT column remains for display; `topic_id` is the normalized FK.

---

## 4. Scraper Architecture

### 4.1 New Package: `packages/scraper`

A standalone Bun CLI tool within the monorepo.

```
packages/scraper/
├── src/
│   ├── index.ts              # CLI entry: orchestrates scrape jobs
│   ├── scrapers/
│   │   ├── poets-org.ts      # Poets.org scraper
│   │   ├── poetry-foundation.ts  # Poetry Foundation scraper (Playwright)
│   │   ├── loc-180.ts        # LOC Poetry 180 scraper
│   │   └── gutenberg.ts      # Gutenberg HTML parser
│   ├── parsers/
│   │   └── poem-parser.ts    # Common HTML → structured poem extraction
│   ├── output/
│   │   └── writer.ts         # Write scraped poems to JSON/NDJSON files
│   └── utils/
│       ├── rate-limiter.ts   # Polite delay between requests
│       ├── dedup.ts          # Title+author deduplication
│       └── logger.ts         # Structured logging
├── data/                     # Scraped output (gitignored)
│   ├── raw/                  # Raw JSON per source
│   └── processed/            # Cleaned, deduped, tagged
├── package.json
└── tsconfig.json
```

### 4.2 Scraper Strategies

#### Poets.org

1. Paginate through `https://poets.org/poems?page=0` to `?page=829`
2. For each row in the table, extract: title, author link/name, year, poem slug
3. Visit each poem detail page (`/poem/{slug}`), extract:
   - Full poem text (from `<div>` containing `<p>` stanzas with `<span>` lines)
   - Theme tags (from the sidebar "Themes" section)
   - Public domain status (from footer text "This poem is in the public domain")
4. **Filter:** Only persist poems marked public domain (or flag non-PD for manual review)
5. **Rate limit:** 1.5s between requests, exponential backoff on 429/5xx
6. **Resume:** Track last-scraped page in a local checkpoint file

#### Poetry Foundation

1. Use Playwright to interact with filter UI (Subjects → "Nature", "Love", "Death", etc.)
2. Scrape resulting poem cards and follow links to detail pages
3. Extract: title, author, full text, subject tags
4. **Rate limit:** 2s between navigations
5. **Fallback:** If JS-heavy rendering is unstable, deprioritize in favor of Poets.org

#### LOC Poetry 180

1. Single page lists all 180 poems with links
2. Visit each linked poem page, extract: title, author, full text
3. Manually assign "contemporary" as a broad topic tag
4. Small corpus — can be scraped in one pass

#### Project Gutenberg (Emerson)

1. Fetch the single HTML page
2. Parse `<h2>`/`<h3>` headings as poem titles
3. Extract text between headings as poem content
4. All poems attributed to "Ralph Waldo Emerson", type `HUMAN`
5. Tag with topics derived from poem titles (e.g., "Nature", "The Sphinx" → "Myth")

### 4.3 Scraped Poem Schema (intermediate JSON)

```typescript
interface ScrapedPoem {
  sourceId: string; // Deterministic hash of source+url
  source: 'poets.org' | 'poetry-foundation' | 'loc-180' | 'gutenberg';
  sourceUrl: string;
  title: string;
  author: string;
  year: string | null;
  content: string; // Newline-separated stanzas, double-newline between stanzas
  themes: string[]; // Raw theme tags from source
  form: string | null; // If available from source
  isPublicDomain: boolean;
  scrapedAt: string; // ISO 8601
}
```

---

## 5. ETL Pipeline

### 5.1 New Package: `packages/etl`

Consumes scraped JSON, transforms, and loads into the database.

```
packages/etl/
├── src/
│   ├── index.ts              # CLI entry: run ETL stages
│   ├── stages/
│   │   ├── 01-clean.ts       # Normalize whitespace, fix encoding, trim
│   │   ├── 02-dedup.ts       # Deduplicate by title+author fuzzy match
│   │   ├── 03-tag.ts         # Map raw themes → canonical topics
│   │   └── 04-load.ts        # Insert into Turso via Drizzle
│   ├── mappings/
│   │   └── theme-to-topic.ts # Raw theme → canonical topic mapping
│   └── utils/
│       └── id-gen.ts         # Deterministic ID generation
├── package.json
└── tsconfig.json
```

### 5.2 Pipeline Stages

#### Stage 1: Clean (`01-clean.ts`)

- Normalize Unicode (NFC)
- Strip HTML entities and residual markup
- Normalize whitespace: single space between words, `\n` between lines, `\n\n` between stanzas
- Trim leading/trailing whitespace from titles and content
- Validate: reject poems with fewer than 4 lines or no title

#### Stage 2: Deduplicate (`02-dedup.ts`)

- Group by normalized `(lowercase(title), lowercase(author))`
- If duplicates exist across sources, prefer: Poets.org > Poetry Foundation > LOC > Gutenberg (richest metadata wins)
- Log deduplicated entries for review

#### Stage 3: Tag (`03-tag.ts`)

Map raw source themes to a canonical set of topics aligned with the project specs:

```typescript
const CANONICAL_TOPICS = [
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

Mapping examples:

- `"Weather"` + `"Nature"` → `nature`
- `"Death"` + `"Grief"` → `mortality`, `grief`
- `"Romance"` + `"Love"` → `love`
- `"Oceans"` → `the-sea`

Poems with no mappable theme get tagged via keyword analysis of the title/content.

#### Stage 4: Load (`04-load.ts`)

1. Upsert topics into the `topics` table
2. Insert poems into `poems` table with `type = 'HUMAN'`, `source`, `source_url`
3. Insert `poem_topics` join records
4. Insert `scrape_sources` provenance records
5. All operations within a transaction

### 5.3 CLI Interface

```bash
# Run full pipeline on all scraped data
pnpm --filter @sanctuary/etl run pipeline

# Run individual stages
pnpm --filter @sanctuary/etl run pipeline --stage clean
pnpm --filter @sanctuary/etl run pipeline --stage dedup
pnpm --filter @sanctuary/etl run pipeline --stage tag
pnpm --filter @sanctuary/etl run pipeline --stage load

# Dry-run (no DB writes)
pnpm --filter @sanctuary/etl run pipeline --dry-run
```

---

## 6. AI Poem Generation Service

### 6.1 New Package: `packages/ai-gen`

Generates AI counterpart poems for human poems in the database.

```
packages/ai-gen/
├── src/
│   ├── index.ts              # CLI entry: generate AI poems
│   ├── generator.ts          # Core generation logic
│   ├── prompts/
│   │   └── poem-prompt.ts    # Prompt templates by topic/style
│   ├── quality/
│   │   └── validator.ts      # Basic quality checks on generated poems
│   └── config.ts             # Model selection, temperature, etc.
├── package.json
└── tsconfig.json
```

### 6.2 Generation Strategy

For each human poem in the database that lacks an AI counterpart:

1. **Select the human poem** and its topic(s)
2. **Build a prompt** that:
   - Specifies the topic
   - Matches approximate length (line count ± 20%)
   - Does NOT reveal the human poem's text (zero-shot, not imitation)
   - Follows the project spec prompt: _"Write a poem about [Topic] in the style of a contemporary master, without rhyming unnecessarily."_
3. **Call Claude API** (Claude Sonnet 4.6 for cost efficiency at scale, Opus for select "featured" duels)
4. **Validate output:**
   - Has ≥ 4 lines
   - Not a refusal or meta-commentary
   - Doesn't contain prompt artifacts
5. **Store** with `type = 'AI'`, `author = 'Claude Sonnet 4.6'`, `prompt` field populated, `parent_poem_id` linking to the human original

### 6.3 Prompt Template

```typescript
const POEM_PROMPT = `Write a poem about {topic}.

Guidelines:
- Write in the style of a contemporary master poet
- Do not rhyme unnecessarily — favor natural language over forced rhyme
- Aim for approximately {lineCount} lines
- The poem should feel authentic, contemplative, and literary
- Do not include a title — just the poem text
- Do not include any commentary or explanation`;
```

### 6.4 Rate Limiting & Cost

- **Batch processing:** Process in batches of 10 with 1s delay between batches
- **Cost estimate:** ~500 poems × ~300 tokens/poem = 150K tokens ≈ $0.45 with Sonnet
- **Checkpoint:** Track generated poem IDs to allow resumable runs

### 6.5 CLI Interface

```bash
# Generate AI counterparts for all unmatched human poems
pnpm --filter @sanctuary/ai-gen run generate

# Generate for a specific topic
pnpm --filter @sanctuary/ai-gen run generate --topic nature

# Limit batch size
pnpm --filter @sanctuary/ai-gen run generate --limit 50

# Use a specific model
pnpm --filter @sanctuary/ai-gen run generate --model claude-sonnet-4-6
```

---

## 7. Duel Assembly

### 7.1 Auto-pairing Logic (in `packages/etl` or `packages/ai-gen`)

After AI poems are generated, assemble duels:

1. For each human poem with an AI counterpart (`parent_poem_id` link):
   - Create a duel with `topic` from the shared topic
   - Randomly assign human/AI to position A or B (prevents positional bias)
2. Mark one duel per topic as "featured" for the daily rotation

### 7.2 Daily Duel Selection

Extend `apps/api/src/routes/duels.ts`:

- `GET /duels/today` → Select a duel that hasn't been featured recently, rotating through topics
- Add a `featured_at` column to `duels` or a separate `featured_duels` table

---

## 8. Environment Variables (New)

| Variable            | Used by | Purpose                                     |
| ------------------- | ------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY` | ai-gen  | Claude API key for poem generation          |
| `AI_MODEL`          | ai-gen  | Model ID (default: `claude-sonnet-4-6`)     |
| `SCRAPE_DELAY_MS`   | scraper | Delay between HTTP requests (default: 1500) |
| `SCRAPE_DATA_DIR`   | scraper | Output directory for scraped data           |

---

## 9. Build Order (Implementation Sequence)

### Phase 1: Schema & Infrastructure [COMPLETED]

1. Add new Drizzle schema tables (`topics`, `poem_topics`, `scrape_sources`)
2. Add new columns to `poems` and `duels`
3. Run `db:push` to apply schema changes
4. Update `@sanctuary/shared` types to reflect new fields

### Phase 2: Scraper & Regression Testing [COMPLETED]

5. Scaffold `packages/scraper` package
6. Implement Gutenberg parser (Ralph Waldo Emerson)
7. Implement LOC Poetry 180 scraper (180 contemporary poems)
8. Implement Poets.org scraper (paginated corpus)
9. Implement Regression Suite (unit + feature behavior tests)
10. Scaffold `packages/e2e` for Playwright/CDP live source validation
11. Deprioritize Poetry Foundation scraper in favor of Poets.org corpus

### Phase 3: ETL [COMPLETED]

11. Scaffold `packages/etl` package — `@sanctuary/etl` wired into pnpm workspace
12. Implement clean stage — Unicode NFC, whitespace normalization, ≥4-line validation
13. Implement dedup stage — exact + fuzzy (title, author) grouping; source priority resolution; provenance merging
14. Implement tag stage — canonical topic mapping + keyword fallback; capped at 3 topics per poem
15. Implement load stage — transactional Drizzle upserts; deterministic SHA-256 IDs for idempotency
16. Run full pipeline; regression verified (stable counts across repeated runs)

See `packages/etl/README.md` for usage, CLI flags, and IO conventions.

### Phase 4: AI Generation

17. Scaffold `packages/ai-gen` package
18. Implement prompt builder
19. Implement Claude API integration (using `@anthropic-ai/sdk`)
20. Implement quality validator
21. Run generation for a small batch, review output
22. Run full generation pass

### Phase 5: Duel Assembly & API Updates

23. Implement auto-pairing logic
24. Update `GET /duels/today` to use topic-based rotation
25. Update `GET /duels` to return topic metadata
26. Update `GET /duels/:id/stats` to include topic and source info

### Phase 6: Frontend Integration (Last)

27. Update Anthology page to filter by canonical topics
28. Show source attribution on Verdict screen
29. Display topic tags on duel cards

---

## 10. Risks & Mitigations

| Risk                                          | Mitigation                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| Copyright infringement from non-PD poems      | Only scrape poems flagged as public domain; store `is_public_domain` flag    |
| Poets.org rate limiting / blocking            | Polite delays, proper User-Agent, checkpoint/resume on failure               |
| Poetry Foundation JS rendering breaks scraper | Deprioritize; Poets.org alone provides 10K+ poems                            |
| AI poems too obviously artificial             | Iterate on prompts; use quality validation; let vote data guide improvements |
| Scraper output too large for single Turso DB  | Start with public-domain subset (~2K poems); scale later                     |
| Topic mapping misses edge cases               | Fallback to keyword extraction; manual review queue                          |

---

## 11. Dependencies to Install

```bash
# packages/scraper
pnpm --filter @sanctuary/scraper add cheerio      # HTML parsing
pnpm --filter @sanctuary/scraper add playwright    # For Poetry Foundation
pnpm --filter @sanctuary/scraper add p-limit       # Concurrency control

# packages/etl
pnpm --filter @sanctuary/etl add drizzle-orm @libsql/client  # DB access
pnpm --filter @sanctuary/etl add fast-glob                    # File discovery

# packages/ai-gen
pnpm --filter @sanctuary/ai-gen add @anthropic-ai/sdk         # Claude API
pnpm --filter @sanctuary/ai-gen add p-limit                   # Rate limiting
```

---

## 12. Success Criteria

- [ ] ≥500 public-domain human poems loaded with topic tags
- [ ] ≥500 AI-generated counterpart poems stored with provenance
- [ ] ≥200 duels auto-assembled across ≥10 distinct topics
- [ ] Daily duel rotation works via `GET /duels/today`
- [ ] Anthology page can filter by topic
- [ ] All scraped data is traceable to its source URL
