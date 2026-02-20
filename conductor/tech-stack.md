# Classicist's Sanctuary - Tech Stack

## Overview

Classicist's Sanctuary is built as a TypeScript-first monorepo using pnpm workspaces to manage its frontend and backend services.

## Frontend (@sanctuary/web)

- **Framework:** React 19
- **Build Tool:** Vite
- **Language:** TypeScript
- **Styling:** Vanilla CSS (targeting a "Digital Letterpress" aesthetic)
- **Deployment:** Nginx container for production

## Backend (@sanctuary/api)

- **Runtime:** Bun 1.3+
- **Framework:** Hono (REST API)
- **Language:** TypeScript
- **Database ORM:** Drizzle ORM
- **Database:** LibSQL (Turso)

## Shared (@sanctuary/shared)

- **Purpose:** Centralized TypeScript types and constants used by both frontend and backend.

## Scraper (@sanctuary/scraper)

- **Runtime:** Bun
- **Libraries:** Cheerio, p-limit
- **Purpose:** Specialized poetry scraping and parsing for multiple sources (Gutenberg, LOC, Poets.org).

## E2E Testing (@sanctuary/e2e)

- **Framework:** Playwright
- **Coverage:** CDP-based live source validation, REST API integration, and full-stack UI tests.

## Infrastructure & Tooling

- **Package Manager:** pnpm 9+
- **Containerization:** Docker & Docker Compose
- **Linting:** ESLint 9 (Flat Config)
- **Formatting:** Prettier
- **Git Hooks:** simple-git-hooks (running lint-staged)
