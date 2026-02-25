# Repository Guidelines

## Project Structure & Module Organization

This repository is a pnpm workspace monorepo.

- `apps/web`: React 19 + Vite frontend (`App.tsx`, `pages/`, `components/`, `lib/`).
- `apps/api`: Bun + Hono API (`src/index.ts`, `src/routes/`, `src/db/` with Drizzle schema/seed).
- `packages/shared`: shared TypeScript types exported across apps.
- `packages/scraper`: Bun-based scraping/parsing utilities with unit tests in `src/**/*.test.ts`.
- `docs/`: architecture, plans, tickets, and domain documentation.

## Build, Test, and Development Commands

Run commands from repo root unless noted.

- `pnpm install`: install all workspace dependencies.
- `pnpm dev`: run web (`:3000`) and api (`:4000`) together.
- `pnpm build`: build shared, web, then api workspaces.
- `pnpm lint`: run ESLint across the repo.
- `pnpm format` / `pnpm format:check`: apply or verify Prettier formatting.
- `pnpm --filter @sanctuary/api test`: run API tests with Bun.
- `pnpm --filter @sanctuary/scraper test`: run scraper tests with Bun.
- `pnpm --filter @sanctuary/api db:push` and `db:seed`: sync and seed LibSQL schema.

## Coding Style & Naming Conventions

- Language: TypeScript (ES modules).
- Formatting: Prettier (`singleQuote: true`, `semi: true`, `tabWidth: 2`, `printWidth: 100`).
- Linting: ESLint v9 + `@typescript-eslint`; React hooks rules in `apps/web`.
- Naming: use `kebab-case` for file names (`rate-limiter.ts`), `PascalCase` for React components (`ReadingRoom.tsx`), and `camelCase` for variables/functions.
- Keep shared contracts in `packages/shared/src/index.ts` to avoid duplicate types.

## Testing Guidelines

- Framework: Bun test runner (`bun test`) in Bun-based packages.
- Place tests next to source as `*.test.ts` (example: `poem-parser.test.ts`).
- Cover success paths, validation failures, and source-specific edge cases for scrapers/parsers.
- Before opening a PR, run: `pnpm lint`, `pnpm format:check`, and relevant package tests.

## Commit & Pull Request Guidelines

- Follow Conventional Commits as seen in history: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `chore: ...`.
- Keep commits focused by module/package.
- PRs should include:
  - clear summary and rationale,
  - linked issue/ticket or plan file when applicable,
  - test commands run and results,
  - screenshots or short recordings for UI changes.

## Security & Configuration Tips

- Never commit secrets; keep credentials in `.env`.
- Required API env vars include `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN`.
- Use `FRONTEND_URL`/`PORT` only as needed for deployment-specific overrides.
