# Classicist's Sanctuary

> "Can you distinguish the soul from the synthesis?"

A blind taste test for the literary mind. Two anonymous poems on a shared topic — one by a celebrated human poet, one by an advanced AI — and a single question: which is which?

**For:** Poetry aficionados, literary skeptics, and the intellectually curious who value text over tech.
**Primary device:** Desktop (tablet secondary).
**Inspired by:** _The Paris Review_, _Poets.org_, _Lapham's Quarterly_.

---

## How It Works

1. Enter **The Reading Room** — two anonymous poems side by side, labelled only "A" and "B".
2. Read both. Choose the one you believe was written by a human.
3. **The Verdict** reveals author identities and community statistics (e.g. _"62% of readers were fooled"_).
4. Browse past duels in **The Anthology**, filtered by theme.

---

## Screens

| Screen               | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| **The Foyer**        | Minimalist landing with a featured duel entry point                  |
| **The Reading Room** | Distraction-free split-screen comparison — no author metadata        |
| **The Verdict**      | Post-vote reveal: author identities, win rates, average reading time |
| **The Anthology**    | Grid archive of past duels, filterable by topic                      |
| **The Colophon**     | Project philosophy and AI generation methodology                     |

---

## Design

**Digital Letterpress.** A quiet, contemplative environment mimicking high-quality print stock — warm alabaster backgrounds, deep ink-like text, generous negative space. No bright blues, no gradients, no tech signifiers.

| Token        | Value     | Role                        |
| ------------ | --------- | --------------------------- |
| Ink          | `#2C2925` | Body text, primary actions  |
| Paper        | `#F4F1EA` | Main background             |
| Stock        | `#EBE7DE` | Cards, surfaces             |
| Seal Red     | `#9E3E36` | Human reveal, active states |
| Binding Blue | `#3A5A6D` | AI reveal                   |

**Type:** Piazzolla (headings) · EB Garamond (body) · Libre Franklin (UI labels only)

---

## Repository Structure

```
classicist-sanctuary-proto/
├── apps/
│   ├── web/          @sanctuary/web    — React 19 + Vite SPA
│   └── api/          @sanctuary/api    — Bun + Hono REST API
├── packages/
│   ├── shared/       @sanctuary/shared — Shared TypeScript types
│   ├── db/           @sanctuary/db     — Drizzle schema + client (shared)
│   ├── scraper/      @sanctuary/scraper — Poem scraper (Poets.org, LOC, Gutenberg)
│   └── etl/          @sanctuary/etl    — ETL pipeline (clean → dedup → tag → load)
├── docs/                               — Project documentation
├── CLAUDE.md                           — Developer reference
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Getting Started

**Prerequisites:** Node.js 20+, pnpm 9+, Bun 1.3+

```bash
# Install all workspace dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Fill in LIBSQL_URL and LIBSQL_AUTH_TOKEN

# Push schema to database
pnpm --filter @sanctuary/api db:push

# Seed with initial poem data
pnpm --filter @sanctuary/api db:seed

# Start both services in parallel
pnpm dev
```

| Service    | URL                   |
| ---------- | --------------------- |
| Web (Vite) | http://localhost:3000 |
| API (Hono) | http://localhost:4000 |

## ETL Pipeline

The ETL pipeline loads scraped poems into the database in four stages: Clean → Deduplicate → Tag → Load.

```bash
# Copy credentials for the ETL package
cp packages/etl/.env.example packages/etl/.env
# Fill in LIBSQL_URL and LIBSQL_AUTH_TOKEN

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

See [`packages/etl/README.md`](./packages/etl/README.md) for the full flag reference, IO conventions, and stage details.

---

## Documentation

See [`docs/`](./docs/README.md) for architecture decisions, domain model, API contracts, and implementation plans.

For a full developer reference (commands, ports, env vars, commit conventions), see [`CLAUDE.md`](./CLAUDE.md).

## Docker

```bash
docker compose up --build
```

| Service     | URL                   |
| ----------- | --------------------- |
| Web (nginx) | http://localhost:3001 |
| API         | http://localhost:4000 |
