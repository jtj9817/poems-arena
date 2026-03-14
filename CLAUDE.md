# Classicist's Sanctuary — CLAUDE.md

## Monorepo Layout

```
classicist-sanctuary-proto/
├── apps/
│   ├── api/                    @sanctuary/api — Bun + Hono REST API (port 4000)
│   │   ├── src/
│   │   │   ├── index.ts        # App entry point, CORS, readiness middleware, routing
│   │   │   ├── errors.ts       # ApiError subclasses: DuelNotFoundError, InvalidPageError,
│   │   │   │                   #   EndpointNotFoundError, MissingSeedError, InvalidSeedError,
│   │   │   │                   #   ServiceUnavailableError
│   │   │   ├── readiness-log.ts # formatDbReadinessFailureLog() — structured log helper
│   │   │   ├── routes/
│   │   │   │   ├── duels.ts    # /duels endpoints (seed+sort ordering, stats, archive)
│   │   │   │   ├── topics.ts   # /topics endpoint
│   │   │   │   ├── votes.ts    # /votes endpoint
│   │   │   │   └── seed-pivot.ts # buildSeedPivot() — SHA-256 duel rotation pivot
│   │   │   └── db/
│   │   │       ├── client.ts   # Initializes singleton DB: calls createDb + resolveDbConfig from @sanctuary/db
│   │   │       ├── config.ts   # Re-export shim: re-exports resolveDbConfig from @sanctuary/db
│   │   │       ├── schema.ts   # Re-export shim for drizzle.config.ts (source of truth: @sanctuary/db)
│   │   │       ├── seed.ts     # Database seed script
│   │   │       ├── readiness.ts         # startDbWarmup(), ensureDbReady(), getDbReadinessSnapshot()
│   │   │       └── readiness-manager.ts # createDbReadinessManager() — bounded retry + timeout state machine
│   │   ├── drizzle.config.ts   # Drizzle Kit configuration
│   │   ├── Dockerfile          # Multi-stage Bun build
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                    @sanctuary/web — React 19 + Vite SPA (port 3000) — branded "Poems Arena"
│       ├── pages/
│       │   ├── Home.tsx        # Landing view; session-seeded featured duel with cold-start retry
│       │   ├── TheRing.tsx     # Active duel voting view; sliding-window prefetch queue
│       │   ├── PastBouts.tsx   # Chronological archive with topic filter (TopicBar + BottomSheetFilter)
│       │   └── About.tsx       # About/credits page
│       ├── components/
│       │   ├── Layout.tsx      # Shell wrapper
│       │   ├── Button.tsx      # Reusable UI button (primary / ghost variants)
│       │   ├── BottomSheetFilter.tsx # Mobile bottom-sheet topic selector
│       │   ├── SourceInfo.tsx  # Per-poem provenance display (revealed post-vote)
│       │   ├── SwipeContainer.tsx   # CSS keyframe wrapper for duel-to-duel swipe transitions
│       │   ├── TopicBar.tsx    # Horizontally scrollable chip bar for topic filtering
│       │   └── VerdictPopup.tsx     # Post-vote modal: verdict, source attribution, stats
│       ├── lib/
│       │   ├── api.ts          # API client (getDuels, getDuel, getDuelStats, vote, getTopics)
│       │   ├── duelQueue.ts    # Immutable sliding-window duel ID queue
│       │   └── session.ts      # getSessionSeed() — tab-local sessionStorage seed with in-memory fallback
│       ├── public/
│       │   ├── favicon.svg     # SVG favicon
│       │   ├── manifest.json   # PWA web app manifest (name: "Poems Arena")
│       │   ├── og-image.svg    # Open Graph share image
│       │   ├── robots.txt      # Crawler rules
│       │   └── sitemap.xml     # Sitemap
│       ├── App.tsx             # Router + view state
│       ├── index.tsx           # React entry point
│       ├── index.html          # HTML template (Tailwind CDN, fonts, CSS keyframes)
│       ├── metadata.json       # Build metadata (version: "0.2", name: "Poems Arena")
│       ├── vite.config.ts      # Vite + proxy config
│       ├── Dockerfile          # Multi-stage nginx build
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── shared/                 @sanctuary/shared — TypeScript types
│   │   └── src/
│   │       └── index.ts        # Shared types (Poem, Duel, Vote, AuthorType, ViewState, DuelResult, TopicMeta, SourceInfo, SourceProvenance)
│   ├── db/                     @sanctuary/db — Drizzle schema + LibSQL client (shared)
│   │   └── src/
│   │       ├── schema.ts       # All DB tables: poems, duels, votes, topics, poem_topics, scrape_sources, featured_duels
│   │       ├── client.ts       # createDb() factory using @libsql/client
│   │       ├── config.ts       # resolveDbConfig() — reads env vars, handles test overrides
│   │       └── index.ts        # Re-exports schema types
│   ├── etl/                    @sanctuary/etl — ETL pipeline (clean → dedup → tag → load)
│   │   ├── src/
│   │   │   ├── index.ts        # CLI entry point (parseCliArgs, stage orchestration)
│   │   │   ├── logger.ts       # Pipeline logger: stageStart, stageEnd, pipelineSummary
│   │   │   ├── stages/
│   │   │   │   ├── 01-clean.ts # Unicode NFC, HTML strip, whitespace normalize, ≥4-line validation
│   │   │   │   ├── 02-dedup.ts # Exact + fuzzy (title, author) dedup; source priority merge
│   │   │   │   ├── 03-tag.ts   # Map raw themes → canonical topics; keyword fallback
│   │   │   │   └── 04-load.ts  # Transactional Drizzle upserts; SHA-256 deterministic IDs
│   │   │   ├── mappings/
│   │   │   │   └── theme-to-topic.ts  # Raw theme → canonical topic lookup table
│   │   │   └── utils/
│   │   │       └── id-gen.ts   # Deterministic SHA-256 poem ID generation
│   │   ├── INPUT_CONTRACT.md   # ScrapedPoem field reference and scraper output conventions
│   │   ├── .env.example        # Required environment variables for the ETL package
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── ai-gen/                 @sanctuary/ai-gen — AI poem generation + duel assembly
│   │   ├── src/
│   │   │   ├── index.ts              # CLI entry point (parseCliArgs, batch orchestration)
│   │   │   ├── cli.ts                # CLI flag parsing and run loop
│   │   │   ├── deepseek-client.ts    # DeepSeek generation client (OpenAI SDK, JSON mode)
│   │   │   ├── verification-agent.ts # Secondary DeepSeek verification call
│   │   │   ├── prompt-builder.ts     # Prompt templates and system prompt loading
│   │   │   ├── generation-service.ts # Generation + verification + validation orchestration
│   │   │   ├── quality-validator.ts  # Output quality validation rules
│   │   │   ├── duel-assembly.ts      # Pair HUMAN↔AI poems into duels (fan-out, idempotent)
│   │   │   └── persistence.ts        # Unmatched selection + idempotent AI poem persistence
│   │   ├── prompts/
│   │   │   └── system-instructions.md  # Generation system prompt
│   │   ├── README.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── scraper/                @sanctuary/scraper — Poem scraper (Poets.org, LOC 180, Gutenberg)
│   │   ├── src/
│   │   │   ├── index.ts        # CLI entry: orchestrates scrape jobs
│   │   │   ├── scrapers/       # Per-source scraper implementations
│   │   │   ├── parsers/        # Common HTML → structured poem extraction
│   │   │   └── utils/          # Rate limiter, logger, dedup helpers
│   │   ├── data/               # Scraped output (gitignored)
│   │   │   └── raw/            # Raw JSON per source (ETL default input)
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── e2e/                    @sanctuary/e2e — Playwright/CDP live source validation
│
├── docs/                       # Project documentation
│   ├── README.md
│   ├── architecture/           # ADRs, system design
│   ├── artifacts/              # Generated analysis artifacts (e.g. ETL remediation data)
│   ├── backend/                # API reference, DB schema notes, AI-gen prompt docs
│   ├── domain/                 # Business logic, duel assembly rules
│   ├── frontend/               # Component API, interaction flows, UI decisions
│   ├── plans/                  # Implementation plans (001-data-pipeline-plan.md [COMPLETE],
│   │                           #   002-duel-randomization-plan.md [SHIPPED])
│   ├── tickets/                # Work items and tracked findings
│   └── archived-plans/         # Completed or superseded plans
│
├── scripts/
│   ├── run-scrape.ts           # Scraper orchestration: Gutenberg, LOC 180, Poets.org → data/raw/
│   ├── run-generate.ts         # AI generation runner shortcut
│   ├── bump-version.ts         # Version bump utility (--minor / --major)
│   ├── deploy.sh               # Deployment helper
│   ├── manual-test-helpers.ts  # Shared helpers for manual verification scripts
│   ├── verify-phase*.ts        # Per-track phase verification scripts (Bun)
│   ├── run-manual-verification-phase-*.sh  # Shell wrappers for phase verification
│   └── ...                     # Phase audit and analysis scripts (see scripts/README.md)
├── package.json                # Root: workspace scripts, devDependencies
├── pnpm-workspace.yaml         # PNPM workspace configuration
├── pnpm-lock.yaml              # Lockfile
├── docker-compose.yml          # Local container orchestration
├── eslint.config.js            # ESLint v9 flat config
├── .prettierrc                 # Prettier formatting rules
├── .prettierignore             # Prettier ignore patterns
├── .gitignore                  # Git ignore patterns
├── .env                        # Turso credentials (never commit)
└── CLAUDE.md                   # This file
```

## Running Locally

```bash
# Install all workspace deps (run from repo root)
pnpm install

# Start both api + web in parallel
pnpm dev

# Or run individually
pnpm --filter @sanctuary/api dev   # http://localhost:4000
pnpm --filter @sanctuary/web dev   # http://localhost:3000
```

The Vite dev server proxies `/api → http://localhost:4000`, so the frontend
always calls `/api/v1/...` regardless of environment.

## Running E2E Tests

E2E tests live in `packages/e2e/` and run with Playwright. The config (`packages/e2e/playwright.config.ts`) reads the root `.env` file and spins up the API and web servers automatically in non-CI environments.

```bash
# Run all E2E tests (requires root .env with LIBSQL_URL + LIBSQL_AUTH_TOKEN)
pnpm --filter @sanctuary/e2e test

# Run a specific project
pnpm --filter @sanctuary/e2e test --project=api
pnpm --filter @sanctuary/e2e test --project=ui
pnpm --filter @sanctuary/e2e test --project=cdp
```

**Test projects:**

| Project | Directory | What it tests |
| --- | --- | --- |
| `api` | `tests/api/` | Live API contract tests (health, topics, duels, votes endpoints) |
| `ui` | `tests/ui/` | Browser UI flows (foyer, anthology, reading room, navigation) |
| `cdp` | `tests/cdp/` | Live scraper source validation via Chrome DevTools Protocol |

In CI, set `CI=true`; Playwright will not reuse existing servers and will use the `list` reporter. The config reads `API_PORT` (default 4000) and `WEB_PORT` (default 3000) from the environment to allow port overrides.

## Scripts

Utility scripts in `scripts/` are run directly with Bun (not via pnpm filter).

### Scraper Orchestration — `scripts/run-scrape.ts`

Calls the Gutenberg, LOC 180, and Poets.org scrapers in sequence and writes output to `packages/scraper/data/raw/`.

```bash
# Scrape all three sources (default)
bun scripts/run-scrape.ts

# Scrape specific sources
bun scripts/run-scrape.ts --sources gutenberg
bun scripts/run-scrape.ts --sources gutenberg,loc-180

# Control Poets.org page depth (default: 3 pages)
bun scripts/run-scrape.ts --sources poets-org --poets-org-pages 10
```

| Flag                  | Default                    | Description                                           |
| --------------------- | -------------------------- | ----------------------------------------------------- |
| `--sources <list>`    | `gutenberg,loc-180,poets-org` | Comma-separated scraper sources to run             |
| `--poets-org-pages N` | `3`                        | Max pages to scrape from Poets.org                    |

Output is written to `packages/scraper/data/raw/` as one NDJSON file per source. This directory is the default `--input-dir` for the ETL pipeline.

---

## Database — Drizzle + Turso (LibSQL)

Schema lives at `packages/db/src/schema.ts` (`@sanctuary/db`). Tables:

```typescript
// poems:         id, title, content, author, type ('HUMAN'|'AI'), year, source, source_url, form, prompt, parent_poem_id
// duels:         id, topic, topic_id, poem_a_id, poem_b_id, created_at
// votes:         id, duel_id, selected_poem_id, is_human, voted_at
// topics:        id, label, created_at
// poem_topics:   poem_id, topic_id  (composite PK — many-to-many)
// scrape_sources: id, poem_id, source, source_url, scraped_at, raw_html, is_public_domain
// featured_duels: id, duel_id, featured_on, created_at
```

The `@sanctuary/db` package is imported by both `apps/api` and `packages/etl`. The API package retains its own `drizzle.config.ts` for schema push/migrate operations.

```bash
# Push schema changes directly to Turso (no migration file, good for dev)
pnpm --filter @sanctuary/api db:push

# Generate a migration SQL file (for production / CI)
pnpm --filter @sanctuary/api db:generate

# Apply generated migrations
pnpm --filter @sanctuary/api db:migrate

# Seed the database with initial poem + duel data
pnpm --filter @sanctuary/api db:seed
```

## ETL Pipeline — @sanctuary/etl

Cleans, deduplicates, tags, and loads scraped poems into the database in four sequential stages. Intermediate NDJSON is written between stages so each can be re-run independently.

```bash
# Copy credentials (only the load stage reads env vars)
cp packages/etl/.env.example packages/etl/.env

# Run the full pipeline
pnpm --filter @sanctuary/etl run pipeline

# Dry-run (no DB writes) with a sample of 50 poems
pnpm --filter @sanctuary/etl run pipeline --dry-run --limit 50

# Run a single stage
pnpm --filter @sanctuary/etl run pipeline --stage clean
pnpm --filter @sanctuary/etl run pipeline --stage dedup
pnpm --filter @sanctuary/etl run pipeline --stage tag
pnpm --filter @sanctuary/etl run pipeline --stage load

# Include non-public-domain poems (manual review workflow)
pnpm --filter @sanctuary/etl run pipeline --include-non-pd
```

| Flag                 | Default                     | Description                                                   |
| -------------------- | --------------------------- | ------------------------------------------------------------- |
| `--stage <name>`     | `all`                       | `clean`, `dedup`, `tag`, `load`, or `all`                     |
| `--input-dir <path>` | `packages/scraper/data/raw` | Directory containing raw scraper output (`*.json`/`*.ndjson`) |
| `--work-dir <path>`  | `packages/etl/data`         | Working directory for intermediate stage outputs              |
| `--dry-run`          | `false`                     | Skip all database writes (stages 1–3 still write files)       |
| `--limit <n>`        | _(none)_                    | Process only the first N poems                                |
| `--include-non-pd`   | `false`                     | Load non-public-domain poems (default: public-domain only)    |

See `packages/etl/README.md` for full stage details, IO conventions, and canonical topics.

## AI Poem Generation — @sanctuary/ai-gen

Generates AI poem counterparts for unmatched HUMAN poems using DeepSeek, then assembles HUMAN↔AI duels.

```bash
# Generate AI counterparts for all unmatched HUMAN poems
pnpm --filter @sanctuary/ai-gen run generate

# Restrict to a topic, limit batch size
pnpm --filter @sanctuary/ai-gen run generate --topic nature --limit 50

# Override concurrency and retry controls
pnpm --filter @sanctuary/ai-gen run generate --concurrency 5 --max-retries 3
```

| Flag            | Default         | Description                                               |
| --------------- | --------------- | --------------------------------------------------------- |
| `--topic`       | _(all)_         | Restrict to a canonical topic ID or label                 |
| `--limit`       | _(all)_         | Maximum number of HUMAN poems to process                  |
| `--model`       | `deepseek-chat` | DeepSeek model name for generation + verification         |
| `--concurrency` | `3`             | Max concurrent generation tasks                           |
| `--max-retries` | `2`             | Retry attempts after retryable validation failures        |

Duel assembly runs automatically after generation. Requires `DEEPSEEK_API_KEY` in environment.

See `packages/ai-gen/README.md` for full runtime behavior and prompt documentation.

## Environment Variables

| Variable                 | Used by        | Purpose                                                                        |
| ------------------------ | -------------- | ------------------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY`       | ai-gen         | DeepSeek API key for poem generation and verification                          |
| `LIBSQL_URL`             | api, etl       | Turso database URL (`libsql://...`) or `file:./local.db` for local SQLite      |
| `LIBSQL_AUTH_TOKEN`      | api, etl       | Turso auth token (leave blank for local file-backed databases)                 |
| `LIBSQL_TEST_URL`        | db (test)      | Separate DB URL used when `NODE_ENV=test` (required for `@sanctuary/db` tests) |
| `LIBSQL_TEST_AUTH_TOKEN` | db (test)      | Auth token for the test database (falls back to `LIBSQL_AUTH_TOKEN`)           |
| `VITE_API_URL`           | web (build)    | API base URL baked into the static bundle (default: `/api/v1`)                 |
| `FRONTEND_URL`           | api (optional) | Additional CORS origin to allow (Cloud Run frontend URL)                       |
| `PORT`                   | api (optional) | Override api listen port (default: 4000)                                       |
| `DB_READY_MAX_ATTEMPTS`  | api (optional) | Max DB warm-up ping attempts before marking `failed` (default: 4)              |
| `DB_READY_RETRY_DELAY_MS`| api (optional) | Delay between warm-up ping retries in milliseconds (default: 300)              |
| `DB_READY_WAIT_TIMEOUT_MS`| api (optional)| Total budget for `ensureDbReady()` to wait for warm-up (default: 2500)        |
| `APP_VERSION`            | api (Docker)   | Set via `BUILD_VERSION` Docker build arg; used by `/health`. Falls back to `package.json` in dev. |

The ETL package reads its own `packages/etl/.env` file (loaded via `dotenv` only when the `load` stage runs). Copy `packages/etl/.env.example` to get started.

## Port Assignments

| Service          | Dev  | Docker       |
| ---------------- | ---- | ------------ |
| `@sanctuary/web` | 3000 | 3001 (nginx) |
| `@sanctuary/api` | 4000 | 4000         |

## Docker

The `docker-compose.yml` references pre-built registry images (`us-west1-docker.pkg.dev/solheim-project/sanctuary/...`) and does not have a `build:` stanza. It is suitable for running already-published images locally, not for building from source.

```bash
# Run pre-built registry images locally (requires docker login to GCR)
docker compose up

# Run a single service from the pre-built image
docker compose up sanctuary-api
```

To build and deploy new images, use the deployment script instead:

```bash
# Build images locally, push to Artifact Registry, and deploy to Cloud Run
bash scripts/deploy.sh
```

See `docs/architecture/deployment.md` for full deployment workflow documentation.

## API Routes

`/health` and `/ready` are not prefixed. All data routes are prefixed `/api/v1/`.

| Method | Path               | Description                                                              |
| ------ | ------------------ | ------------------------------------------------------------------------ |
| GET    | `/health`          | Health check — returns `{ status: "ok", version }`. Does not check DB.  |
| GET    | `/ready`           | Readiness check — returns `{ status, ready }`. Reports DB warm-up state.|
| GET    | `/api/v1/topics`          | All canonical topics ordered by label                             |
| GET    | `/api/v1/duels`           | Paginated archive. Requires `?seed=N` or `?sort=recent`. Supports `?page=N&topic_id=<id>`. |
| GET    | `/api/v1/duels/:id`       | Single duel (anonymous — no author info). Logs to `featured_duels`. |
| POST   | `/api/v1/votes`           | Cast a vote `{ duelId, selectedPoemId }`                          |
| GET    | `/api/v1/duels/:id/stats` | Full stats + author reveal after voting                           |

> `GET /duels/today` was removed in Phase 5. Returns `404 ENDPOINT_NOT_FOUND`.

### `GET /duels` Ordering Rules

`GET /duels` requires one of two ordering modes:
- **Seeded rotation** — pass `?seed=<non-negative integer>`. The API hashes the seed into a pivot duel ID and rotates `duels.id ASC` around it. Home and TheRing use this mode with a session-scoped seed from `sessionStorage`.
- **Chronological** — pass `?sort=recent`. Preserves `created_at DESC` ordering. PastBouts uses this mode.

Omitting both returns `400 MISSING_SEED`. An invalid seed value returns `400 INVALID_SEED`.

### Response Examples

**GET /topics**:

```json
[
  { "id": "nature", "label": "Nature" },
  { "id": "love", "label": "Love" }
]
```

**GET /duels** (paginated archive; requires `?seed=N` or `?sort=recent`; `?topic_id=nature` optional):

```json
[
  {
    "id": "duel-123",
    "topic": "The Moon",
    "topicMeta": { "id": "nature", "label": "Nature" },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "humanWinRate": 67,
    "avgDecisionTimeMs": 120000,
    "avgDecisionTime": "2m 00s"
  }
]
```

> `avgDecisionTimeMs`/`avgDecisionTime` are topic-level behavioral averages from `topic_statistics`. Both are `null` until at least one timed vote exists for the topic. The old `avgReadingTime` word-count estimate has been removed.

**GET /duels/:id** (anonymous, no author info):

```json
{
  "id": "duel-123",
  "topic": "The Moon",
  "poemA": { "id": "p1", "title": "Silver Light", "content": "..." },
  "poemB": { "id": "p2", "title": "Lunar Glow", "content": "..." }
}
```

**POST /votes**:

```json
// Request
{ "duelId": "duel-123", "selectedPoemId": "p1", "readingTimeMs": 45000 }

// Response
{ "success": true, "isHuman": true }
```

> `readingTimeMs` is required. Values ≤ 0 are rejected (400). Values > 600000 are clamped to 600000 (10 minutes).

**GET /duels/:id/stats** (after voting, full reveal):

```json
{
  "humanWinRate": 67,
  "globalStats": {
    "totalVotes": 1240,
    "humanWinRate": 72,
    "avgDecisionTimeMs": 120000,
    "avgDecisionTime": "2m 00s"
  },
  "topicStats": {
    "topicMeta": { "id": "nature", "label": "Nature" },
    "totalVotes": 84,
    "humanWinRate": 75,
    "avgDecisionTimeMs": 95000,
    "avgDecisionTime": "1m 35s"
  },
  "duel": {
    "id": "duel-123",
    "topic": "The Moon",
    "topicMeta": { "id": "nature", "label": "Nature" },
    "poemA": {
      "id": "p1",
      "title": "...",
      "content": "...",
      "author": "Emily Dickinson",
      "type": "HUMAN",
      "year": "1890",
      "sourceInfo": {
        "primary": { "source": "poets.org", "sourceUrl": "https://poets.org/poem/..." },
        "provenances": [{ "source": "poets.org", "sourceUrl": "...", "scrapedAt": "...", "isPublicDomain": true }]
      }
    },
    "poemB": {
      "id": "p2",
      "title": "...",
      "content": "...",
      "author": "deepseek-chat",
      "type": "AI",
      "sourceInfo": { "primary": { "source": null, "sourceUrl": null }, "provenances": [] }
    }
  }
}
```

## Shared Types (@sanctuary/shared)

Located in `packages/shared/src/index.ts`:

```typescript
export enum AuthorType {
  HUMAN = 'HUMAN',
  AI = 'AI',
}

/** Sanitizes and validates an external URL, returning null for unsafe or non-http(s) values. */
export function sanitizeExternalHttpUrl(url: string | null | undefined): string | null;

/** Canonical topic reference returned by the API. id is null when the duel has no linked topic row. */
export interface TopicMeta {
  id: string | null;
  label: string;
}

/** Minimal topic record (used internally; TopicMeta is the canonical API shape). */
export interface Topic {
  id: string;
  label: string;
}

export interface SourceProvenance {
  source: string;
  sourceUrl: string;
  scrapedAt: string;
  isPublicDomain: boolean;
}

export interface SourceInfo {
  primary: { source: string | null; sourceUrl: string | null };
  provenances: SourceProvenance[];
}

export interface Poem {
  id: string;
  title: string;
  content: string;
  author: string;           // "Emily Dickinson" or the AI model name
  type: AuthorType;
  year?: string;
  source?: string;
  sourceUrl?: string;
  form?: string;
  prompt?: string;          // AI generation prompt (absent for human poems)
  parentPoemId?: string;    // AI poem's human counterpart ID
  sourceInfo?: SourceInfo;  // Populated in GET /duels/:id/stats only
}

export interface DuelListItem {
  id: string;
  topic: string;
  topicMeta: TopicMeta;
  createdAt: string;
  humanWinRate: number;          // Integer percentage 0–100
  avgDecisionTimeMs: number | null; // Topic-level behavioral avg; null if no timing samples
  avgDecisionTime: string | null;   // e.g., "2m 00s"; null if no timing samples
}

export interface GlobalStats {
  totalVotes: number;
  humanWinRate: number;          // Integer percentage 0–100
  avgDecisionTimeMs: number | null;
  avgDecisionTime: string | null;
}

export interface TopicStats {
  topicMeta: TopicMeta;
  totalVotes: number;
  humanWinRate: number;          // Integer percentage 0–100
  avgDecisionTimeMs: number | null;
  avgDecisionTime: string | null;
}

export interface DuelStatsResponse {
  humanWinRate: number;          // Per-duel win rate: integer 0–100
  globalStats: GlobalStats;
  topicStats: TopicStats;
  duel: Duel;                    // Full reveal with author, type, year, sourceInfo
}

export interface VoteRequest {
  duelId: string;
  selectedPoemId: string;
  readingTimeMs: number;         // Required; positive integer ms; >600000 clamped server-side
}

export interface VoteResponse {
  success: boolean;
  isHuman: boolean;
}

export enum ViewState {
  HOME = 'HOME',
  THE_RING = 'THE_RING',
  PAST_BOUTS = 'PAST_BOUTS',
  ABOUT = 'ABOUT',
}

export interface DuelResult {
  duelId: string;
  selectedPoemId: string;
  isHuman: boolean;
}
```

## Commit Conventions

Conventional Commits: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`

Examples:

- `feat(api): add pagination to /duels endpoint`
- `fix(web): correct import path for shared types`
- `chore: update drizzle-kit to v0.30`

## Linting & Formatting

```bash
pnpm lint          # ESLint across all packages
pnpm format        # Prettier (write)
pnpm format:check  # Prettier (CI check)
```

Pre-commit hook (via `simple-git-hooks` + `lint-staged`) runs ESLint + Prettier
automatically on staged `.ts`/`.tsx` files.

## Cloud Run Deployment Notes

- API container: stateless — reads env vars injected by Cloud Run secrets.
  `GET /health` returns `{ status: "ok", version }` without touching the DB (Cloud Run liveness probe).
  `GET /ready` reports DB warm-up state and returns `503` until the database is reachable.
- The API starts a background DB warm-up (`startDbWarmup`) at boot and gates all `/api/v1/*` routes
  behind `ensureDbReady()`. Requests that arrive before the DB is ready receive `503 SERVICE_UNAVAILABLE`.
- The Home page handles `503` responses from the API with a bounded client-side retry loop
  (up to 4 attempts with increasing delays) and displays an animated loading state to the user.
- Web container: pure static nginx. `VITE_API_URL` must be set as a Docker build
  arg pointing to the deployed API URL.
- Both containers use `CMD` (not `ENTRYPOINT`) for Cloud Run compatibility.
