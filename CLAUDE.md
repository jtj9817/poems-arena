# Classicist's Sanctuary — CLAUDE.md

## Monorepo Layout

```
classicist-sanctuary-proto/
├── apps/
│   ├── api/          @sanctuary/api   — Bun + Hono REST API (port 4000)
│   └── web/          @sanctuary/web   — React 19 + Vite SPA (port 3000 dev / 3001 Docker)
├── packages/
│   └── shared/       @sanctuary/shared — TypeScript types shared by api and web
├── pnpm-workspace.yaml
├── package.json      — Root: scripts, devDependencies (ESLint, Prettier, lint-staged)
├── eslint.config.js
├── .prettierrc
├── docker-compose.yml
└── .env              — Turso credentials (never commit)
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
