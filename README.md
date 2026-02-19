# Classicist's Sanctuary

A literary Turing test. Two poems — one by a human master, one by a machine. Can you tell them apart?

---

## Overview

Classicist's Sanctuary presents anonymous poem duels and asks readers to identify which was written by a human and which by an AI. After voting, the author identities are revealed alongside community statistics.

## Repository Structure

```
classicist-sanctuary-proto/
├── apps/
│   ├── web/          @sanctuary/web   — React 19 + Vite SPA
│   └── api/          @sanctuary/api   — Bun + Hono REST API
├── packages/
│   └── shared/       @sanctuary/shared — Shared TypeScript types
├── docs/                              — Project documentation
├── CLAUDE.md                          — Developer reference
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
# Fill in LIBSQL_URL and LIBSQL_AGILIQUILL_TOKEN

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
