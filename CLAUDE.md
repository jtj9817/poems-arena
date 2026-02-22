# Classicist's Sanctuary — CLAUDE.md

## Monorepo Layout

```
classicist-sanctuary-proto/
├── apps/
│   ├── api/                    @sanctuary/api — Bun + Hono REST API (port 4000)
│   │   ├── src/
│   │   │   ├── index.ts        # App entry point, CORS, routing
│   │   │   ├── routes/
│   │   │   │   ├── duels.ts    # /duels endpoints
│   │   │   │   └── votes.ts    # /votes endpoint
│   │   │   └── db/
│   │   │       ├── client.ts   # Thin wrapper: re-exports createDb from @sanctuary/db
│   │   │       ├── schema.ts   # Re-export shim for drizzle.config.ts (source of truth: @sanctuary/db)
│   │   │       └── seed.ts     # Database seed script
│   │   ├── drizzle.config.ts   # Drizzle Kit configuration
│   │   ├── Dockerfile          # Multi-stage Bun build
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                    @sanctuary/web — React 19 + Vite SPA (port 3000)
│       ├── pages/
│       │   ├── Foyer.tsx       # Landing view
│       │   ├── ReadingRoom.tsx # Active duel voting view
│       │   ├── Anthology.tsx   # Archive of past duels
│       │   └── Colophon.tsx    # About/credits page
│       ├── components/
│       │   ├── Layout.tsx      # Shell wrapper
│       │   └── Button.tsx      # Reusable UI
│       ├── lib/
│       │   └── api.ts          # API client utilities
│       ├── App.tsx             # Router + view state
│       ├── index.tsx           # React entry point
│       ├── index.html          # HTML template
│       ├── metadata.json       # Build metadata
│       ├── vite.config.ts      # Vite + proxy config
│       ├── Dockerfile          # Multi-stage nginx build
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── shared/                 @sanctuary/shared — TypeScript types
│   │   └── src/
│   │       └── index.ts        # Shared types (Poem, Duel, Vote, AuthorType, ViewState, DuelResult)
│   ├── db/                     @sanctuary/db — Drizzle schema + LibSQL client (shared)
│   │   └── src/
│   │       ├── schema.ts       # All DB tables: poems, duels, votes, topics, poem_topics, scrape_sources
│   │       ├── client.ts       # createDb() factory using @libsql/client
│   │       ├── config.ts       # resolveDbConfig() — reads env vars, handles test overrides
│   │       └── index.ts        # Re-exports schema types
│   ├── etl/                    @sanctuary/etl — ETL pipeline (clean → dedup → tag → load)
│   │   ├── src/
│   │   │   ├── index.ts        # CLI entry point (parseCliArgs, stage orchestration)
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
│   ├── architecture/
│   ├── backend/
│   ├── domain/
│   ├── frontend/
│   ├── plans/                  # Active implementation plans (001-data-pipeline-plan.md)
│   ├── tickets/                # Work items and tracked findings
│   └── archived-plans/
│
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

## Database — Drizzle + Turso (LibSQL)

Schema lives at `packages/db/src/schema.ts` (`@sanctuary/db`). Tables:

```typescript
// poems:         id, title, content, author, type ('HUMAN'|'AI'), year, source, source_url, form, prompt, parent_poem_id
// duels:         id, topic, topic_id, poem_a_id, poem_b_id, created_at
// votes:         id, duel_id, selected_poem_id, is_human, voted_at
// topics:        id, label, created_at
// poem_topics:   poem_id, topic_id  (composite PK — many-to-many)
// scrape_sources: id, poem_id, source, source_url, scraped_at, raw_html, is_public_domain
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

## Environment Variables

| Variable                       | Used by        | Purpose                                                                        |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------ |
| `LIBSQL_URL`                   | api, etl       | Turso database URL (`libsql://...`) or `file:./local.db` for local SQLite      |
| `LIBSQL_AGILIQUILL_TOKEN`      | api, etl       | Turso auth token (leave blank for local file-backed databases)                 |
| `LIBSQL_TEST_URL`              | db (test)      | Separate DB URL used when `NODE_ENV=test` (required for `@sanctuary/db` tests) |
| `LIBSQL_TEST_AGILIQUILL_TOKEN` | db (test)      | Auth token for the test database (falls back to `LIBSQL_AGILIQUILL_TOKEN`)     |
| `VITE_API_URL`                 | web (build)    | API base URL baked into the static bundle (default: `/api/v1`)                 |
| `FRONTEND_URL`                 | api (optional) | Additional CORS origin to allow (Cloud Run frontend URL)                       |
| `PORT`                         | api (optional) | Override api listen port (default: 4000)                                       |

The ETL package reads its own `packages/etl/.env` file (loaded via `dotenv` only when the `load` stage runs). Copy `packages/etl/.env.example` to get started.

## Port Assignments

| Service          | Dev  | Docker       |
| ---------------- | ---- | ------------ |
| `@sanctuary/web` | 3000 | 3001 (nginx) |
| `@sanctuary/api` | 4000 | 4000         |

## Docker

```bash
# Build and run both containers
docker compose up --build

# Api only
docker compose up sanctuary-api --build
```

## API Routes

All routes are prefixed `/api/v1/`.

| Method | Path               | Description                              |
| ------ | ------------------ | ---------------------------------------- |
| GET    | `/health`          | Health check (Cloud Run probe)           |
| GET    | `/duels`           | Paginated duel archive (`?page=N`)       |
| GET    | `/duels/today`     | Today's featured duel (anonymous)        |
| GET    | `/duels/:id`       | Single duel (anonymous)                  |
| POST   | `/votes`           | Cast a vote `{ duelId, selectedPoemId }` |
| GET    | `/duels/:id/stats` | Full stats + author reveal after voting  |

### Response Examples

**GET /duels** (paginated archive):

```json
[
  {
    "id": "duel-123",
    "topic": "The Moon",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "humanWinRate": 67,
    "avgReadingTime": "3m 30s"
  }
]
```

**GET /duels/today** and **GET /duels/:id** (anonymous, no author info):

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
{ "duelId": "duel-123", "selectedPoemId": "p1" }

// Response
{ "success": true, "isHuman": true }
```

**GET /duels/:id/stats** (after voting, full reveal):

```json
{
  "humanWinRate": 67,
  "avgReadingTime": "3m 30s",
  "duel": {
    "id": "duel-123",
    "topic": "The Moon",
    "poemA": {
      "id": "p1",
      "title": "...",
      "content": "...",
      "author": "Emily Dickinson",
      "type": "HUMAN",
      "year": "1890"
    },
    "poemB": {
      "id": "p2",
      "title": "...",
      "content": "...",
      "author": "Claude 3 Opus",
      "type": "AI"
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

export interface Poem {
  id: string;
  title: string;
  content: string;
  author: string; // "Emily Dickinson" or "Claude 3 Opus"
  type: AuthorType;
  year?: string;
}

export interface Duel {
  id: string;
  topic: string;
  poemA: Poem;
  poemB: Poem;
  humanWinRate: number;
  avgReadingTime: string;
}

export enum ViewState {
  FOYER = 'FOYER',
  READING_ROOM = 'READING_ROOM',
  ANTHOLOGY = 'ANTHOLOGY',
  COLOPHON = 'COLOPHON',
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
  `GET /health` is the health check endpoint.
- Web container: pure static nginx. `VITE_API_URL` must be set as a Docker build
  arg pointing to the deployed API URL.
- Both containers use `CMD` (not `ENTRYPOINT`) for Cloud Run compatibility.
