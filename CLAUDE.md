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
│   │   │       ├── client.ts   # Drizzle + LibSQL client
│   │   │       ├── schema.ts   # Database tables (poems, duels, votes)
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
│   └── shared/                 @sanctuary/shared — TypeScript types
│       └── src/
│           └── index.ts        # Shared types (Poem, Duel, Vote, AuthorType)
│
├── docs/                       # Project documentation
│   ├── README.md
│   ├── architecture/
│   ├── backend/
│   ├── domain/
│   ├── frontend/
│   ├── plans/
│   ├── tickets/
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

Schema lives at `apps/api/src/db/schema.ts`. Tables: `poems`, `duels`, `votes`.

```typescript
// poems: id, title, content, author, type ('HUMAN' | 'AI'), year
// duels: id, topic, poemAId, poemBId, createdAt
// votes: id, duelId, selectedPoemId, isHuman, votedAt
```

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

## Environment Variables

| Variable                  | Used by        | Purpose                                                        |
| ------------------------- | -------------- | -------------------------------------------------------------- |
| `LIBSQL_URL`              | api            | Turso database URL (libsql://...)                              |
| `LIBSQL_AGILIQUILL_TOKEN` | api            | Turso auth token                                               |
| `VITE_API_URL`            | web (build)    | API base URL baked into the static bundle (default: `/api/v1`) |
| `FRONTEND_URL`            | api (optional) | Additional CORS origin to allow (Cloud Run frontend URL)       |
| `PORT`                    | api (optional) | Override api listen port (default: 4000)                       |

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
