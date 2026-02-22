# Classicist's Sanctuary - Project Context

## Project Overview

Classicist's Sanctuary is a digital "blind taste test" for poetry, designed to challenge readers to distinguish between human-authored and AI-generated poems. The platform presents two anonymous poems side-by-side and asks the user to identify which one was written by a human.

- **Primary Goal:** Provide a contemplative, minimalist environment for literary comparison.
- **Key Features:**
  - **The Foyer:** Landing page with the featured daily duel.
  - **The Reading Room:** Distraction-free voting interface.
  - **The Verdict:** Reveal of author identities and community statistics.
  - **The Anthology:** Filterable archive of past duels.
  - **The Colophon:** Project philosophy and methodology.

## Tech Stack

The project is organized as a monorepo using **pnpm workspaces**.

- **Frontend (`apps/web`):** React 19, Vite, TypeScript. Uses a "Digital Letterpress" aesthetic (Paper: `#F4F1EA`, Ink: `#2C2925`).
- **Backend (`apps/api`):** Bun, Hono (REST API), TypeScript.
- **Database:** LibSQL (Turso) with **Drizzle ORM**.
- **Shared (`packages/shared`):** Shared TypeScript types used by both frontend and backend.
- **Infrastructure:** Docker, Nginx (for web), designed for Cloud Run deployment.

## Key Directories

- `apps/api`: Bun/Hono REST API.
- `apps/web`: React/Vite SPA.
- `packages/shared`: Shared types and constants.
- `docs/`: Extensive documentation (architecture, plans, domain model).

## Core Commands

### Development

```bash
# Install dependencies
pnpm install

# Start both API and Web in parallel
pnpm dev

# Start specific services
pnpm --filter @sanctuary/api dev   # API on port 4000
pnpm --filter @sanctuary/web dev   # Web on port 3000
```

### Database Management

```bash
# Push schema changes to the database
pnpm --filter @sanctuary/api db:push

# Generate migrations
pnpm --filter @sanctuary/api db:generate

# Seed initial data
pnpm --filter @sanctuary/api db:seed
```

### Build & Maintenance

```bash
# Build the entire project
pnpm build

# Linting and Formatting
pnpm lint          # Run ESLint
pnpm format        # Run Prettier (fix)
pnpm format:check  # Check formatting
```

## Development Conventions

- **Shared Types:** Always use `@sanctuary/shared` for types that exist in both frontend and backend.
- **API Versioning:** All API routes are prefixed with `/api/v1/`.
- **Commits:** Use Conventional Commits (`feat(scope): description`, `fix(scope): description`, etc.).
- **Styling:** Follow the "Digital Letterpress" design tokens defined in `README.md`.
- **Linting:** ESLint v9 (flat config) and Prettier are enforced via pre-commit hooks.

## Reference Documentation

- `CLAUDE.md`: Comprehensive developer guide for commands, ports, and environment variables.
- `project-specs.md`: Detailed product requirements and user stories.
- `docs/README.md`: Index of architectural and domain documentation.

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

## E2E Tests — @sanctuary/e2e

End-to-end tests that validate the complete user journey from landing page to vote submission.

```bash
# Run all E2E tests
pnpm --filter @sanctuary/e2e run test

# Run with video recording on failure
pnpm --filter @sanctuary/e2e run test:video

# Run a single test file
pnpm --filter @sanctuary/e2e run test tests/landing.test.ts
```

See `packages/e2e/README.md` for environment variables, test structure, and debugging tips.

## Running Commands

- Use `CI=true` to run commands in a CI environment by default.
