# Implementation Plan: Implement Poem Scraper Package and Source Parsers

This plan covers Phase 2 of the Data Pipeline, focusing on the initial scraper implementation.

## Phase 1: Scaffolding and Core Utilities

- [x] Task: Scaffold `packages/scraper` package
  - [x] Create directory structure and `package.json`
  - [x] Configure `tsconfig.json`
  - [x] Install dependencies (`cheerio`, `p-limit`, `@sanctuary/shared`)
- [x] Task: Implement Core Scraper Utilities
  - [x] Write tests for common HTML parser utility
  - [x] Implement `parsers/poem-parser.ts` (HTML -> structured text)
  - [x] Implement `utils/rate-limiter.ts`
  - [x] Implement `utils/logger.ts`

## Phase 2: Source Implementations

- [x] Task: Implement Project Gutenberg (Emerson) Parser f624157
  - [x] Write tests for Gutenberg parser f624157
  - [x] Implement `scrapers/gutenberg.ts` f624157
  - [x] Verify extraction of title, author, and content from sample HTML f624157
- [x] Task: Implement LOC Poetry 180 Scraper f624157
  - [x] Write tests for LOC scraper f624157
  - [x] Implement `scrapers/loc-180.ts` f624157
  - [x] Verify collection of 180 poems and metadata f624157
- [x] Task: Implement Poets.org Scraper f624157
  - [x] Write tests for Poets.org list and detail scrapers f624157
  - [x] Implement `scrapers/poets-org.ts` with pagination and checkpointing f624157
  - [x] Verify extraction of themes and public domain status f624157
- [x] Task: Conductor - User Manual Verification 'Phase 2: Scraper' (Protocol in workflow.md)
  - Manual verification summary:
  - Run `CI=true pnpm --filter @sanctuary/scraper test`.
  - Run `CI=true pnpm --filter @sanctuary/api test -- src/db/config.test.ts`.
  - Run `CI=true pnpm --filter @sanctuary/scraper test:live`.
  - Validate verbose logs with `SCRAPER_VERBOSE=true` and confirm `debug`/`info` output includes `source` and `sourceUrl`.
  - Confirm test DB isolation: live scraper writes to `SCRAPER_TEST_DB_PATH` and API config in `NODE_ENV=test` uses `LIBSQL_TEST_URL` (not `LIBSQL_URL`).
  - Automation script: `scripts/run-manual-verification-phase-2.sh`.

## Phase 3: Regression & Quality Gate

**Goal:** Lock in correctness with a regression pass, fill unit test gaps, stand up E2E infrastructure (Playwright + CDP), and run full-stack end-to-end validation.

### 3A: Coverage and Regression Verification

- [x] Task: Run existing test suite and static checks
  - [x] Execute `CI=true pnpm --filter @sanctuary/scraper test` and resolve failures.
  - [x] Execute `CI=true pnpm --filter @sanctuary/api test` and resolve failures.
  - [x] Execute `pnpm lint` and resolve linting errors.
  - [x] Execute `pnpm format:check` and resolve formatting issues.

- [x] Task: Add unit tests for `packages/scraper/src/utils/hashing.ts`
  - [x] Create `packages/scraper/src/utils/hashing.test.ts` (bun:test).
  - [x] Test: deterministic output for same (source, url, title) triple.
  - [x] Test: different IDs for different inputs.
  - [x] Test: non-empty string for minimal/empty inputs.
  - [x] Test: stable across repeated calls (no randomness).

- [x] Task: Add unit tests for `packages/scraper/src/utils/html.ts`
  - [x] Create `packages/scraper/src/utils/html.test.ts` (bun:test).
  - [x] `decodeHtmlEntities`: named entities, numeric refs, passthrough.
  - [x] `stripHtml`: simple tags, nested tags, entity decoding after strip.
  - [x] `normalizeWhitespace`: collapse spaces/tabs, collapse 3+ newlines, remove `\r`, trim.
  - [x] `extractTagMatches`: multiple same-type tags, mixed types, attributes, empty input.
  - [x] `extractAnchors`: href+text extraction, nested HTML in anchor text.
  - [x] `extractAnchorsByHrefPrefix`: prefix filtering, empty result.
  - [x] `extractFirstClassInnerHtml`: match, no match, priority order across classes.
  - [x] `extractFirstTagText`: match, no match.
  - [x] `extractFirstTagTextByClass`: tag+class combo match, no match.
  - [x] `hasCaseInsensitiveText`: true/false cases, strips HTML before checking.
  - [x] `removeTags`: removes specified tags+content, preserves surrounding content.

### 3B: Regression Checklist -- Scraper Feature Behaviors

- [x] Task: Gutenberg regression tests (extend `gutenberg.test.ts`)
  - [x] Heading exclusion (CONTENTS, NOTES, PREFACE, APPENDIX not scraped as poems).
  - [x] Empty content between headings is skipped.
  - [x] All poems: `source: 'gutenberg'`, `author: 'Ralph Waldo Emerson'`, `isPublicDomain: true`.
  - [x] `sourceId` determinism — same mock HTML produces identical IDs.
  - [x] Network exception (fetch throws) returns `[]`, does not throw.
  - [x] Custom `fetchImpl` option is respected.

- [x] Task: LOC-180 regression tests (extend `loc-180.test.ts`)
  - [x] Range handling: `scrapeLoc180(5, 7)` makes exactly 3 fetch calls for poems in range.
  - [x] Graceful 404: missing poem filtered out, others still returned.
  - [x] All poems: `source: 'loc-180'`, `isPublicDomain: false`.
  - [x] `sourceUrl` contains the poem URL.
  - [x] Fallback extraction: title tag when dc.title meta missing.
  - [x] Fallback content: `main-content` class when `poem pre` missing.

- [x] Task: Poets.org regression tests (extend `poets-org.test.ts`)
  - [x] Pagination: `getPoemUrls(3)` fetches pages 0, 1, 2.
  - [x] Duplicate URL deduplication across pages.
  - [x] Public domain detection: positive (theme-based), positive (footer text), negative (copyright).
  - [x] Theme extraction from `/themes/` anchors.
  - [x] Form extraction from `/forms/` anchors.
  - [x] Content body fallback chain (multiple class selectors).
  - [x] Graceful 404 on detail page.

- [x] Task: Rate limiter regression tests (extend `rate-limiter.test.ts`)
  - [x] Concurrency=2 allows exactly 2 concurrent tasks.
  - [x] Tasks beyond limit queue and execute when slot opens.
  - [x] Error in one task does not block subsequent tasks.

- [x] Task: Cross-cutting regression tests
  - [x] Create `packages/scraper/src/scrapers/schema-validation.test.ts` (bun:test).
  - [x] All scrapers return objects conforming to `ScrapedPoem` (all required fields, correct types).
  - [x] `scrapedAt` is valid ISO 8601.

### 3C: E2E Infrastructure Setup

- [x] Task: Create `packages/e2e` workspace package
  - [x] `packages/e2e/package.json`: `@sanctuary/e2e`, devDeps `@playwright/test`, `@types/node`.
  - [x] Scripts: `test` -> `npx playwright test`, `test:cdp`, `test:api`, `test:ui`.
  - [x] `packages/e2e/tsconfig.json` targeting ES2022, module ESNext.
  - [x] `pnpm install` to integrate workspace.
  - [x] `npx playwright install chromium` to download browser binary.

- [x] Task: Configure Playwright
  - [x] Create `packages/e2e/playwright.config.ts` with 3 projects: `cdp`, `api`, `ui`.
  - [x] `use.headless: true` (CI default).
  - [x] `webServer` config for `ui` project: start API (port 4000) + Web (port 3000).
  - [x] `timeout: 30_000`, `globalTimeout: 120_000`, `retries: 0`.

- [x] Task: Create CDP utility helpers
  - [x] `packages/e2e/lib/cdp-helpers.ts`:
    - `createCDPSession(page)` — wraps `page.context().newCDPSession(page)`.
    - `querySelectorAllViaDOM(session, selector)` — `Runtime.evaluate` with `document.querySelectorAll`.
    - `getOuterHTMLViaDOM(session, selector)` — returns raw HTML of first match.

- [x] Task: Create test fixtures and helpers
  - [x] `packages/e2e/lib/api-test-helpers.ts`: `API_BASE_URL`, `apiGet()`, `apiPost()`, `apiRootGet()`.
  - [x] `packages/e2e/lib/fixtures.ts`: shared test data constants (scraper source URLs, content classes).
  - [x] `packages/e2e/lib/assert-schema.ts`: runtime validators for API response shapes.

### 3D: E2E Test Suites

- [x] Task: Scraper CDP validation tests (structural regression against live pages)
  - [x] `packages/e2e/tests/cdp/scraper-source-validation.spec.ts` (skippable via `SKIP_LIVE_CDP=true`).
  - [x] Gutenberg page has `<h2>`/`<h3>` headings for poem titles.
  - [x] LOC Poetry 180 page has links matching `poetry-180-` pattern.
  - [x] Poets.org list page has `a[href^="/poem/"]` links.
  - [x] Poets.org detail page has at least one of the content body classes.

- [x] Task: API integration tests
  - [x] `packages/e2e/tests/api/health.spec.ts`: `GET /health` returns `{ status: 'ok' }`.
  - [x] `packages/e2e/tests/api/duels.spec.ts`:
    - `GET /api/v1/duels` returns array with correct shape.
    - `GET /api/v1/duels?page=1` returns first page.
    - `GET /api/v1/duels/today` returns anonymous duel (no `author`/`type` on poems).
    - `GET /api/v1/duels/:id` with invalid ID returns 404.
    - `GET /api/v1/duels/:id/stats` returns full reveal with `author`, `type`.
  - [x] `packages/e2e/tests/api/votes.spec.ts`:
    - `POST /api/v1/votes` with valid body returns `{ success, isHuman }`.
    - Invalid `duelId` returns 404.
    - Missing fields returns 400.

- [x] Task: Full-stack UI E2E tests with Playwright
  - [x] `packages/e2e/tests/ui/foyer.spec.ts`: page loads, heading visible, "Enter Reading Room" button.
  - [x] `packages/e2e/tests/ui/reading-room.spec.ts`:
    - Two poems displayed ("Exhibit A", "Exhibit B"), two "Select This Work" buttons.
    - Voting: click button -> verdict overlay appears with result message + stats.
    - Verdict overlay has "Review Poems" and "Next Duel" buttons.
  - [x] `packages/e2e/tests/ui/anthology.spec.ts`: "The Anthology" heading, duel cards with win rates.
  - [x] `packages/e2e/tests/ui/navigation.spec.ts`: Foyer -> ReadingRoom -> Anthology -> Colophon -> Foyer.

### 3E: Conductor Manual Verification

- [x] Task: Conductor - User Manual Verification 'Phase 3: Regression & Quality Gate' (Protocol in workflow.md)
  - Run `CI=true pnpm --filter @sanctuary/scraper test` (all scraper tests including new ones).
  - Run `CI=true pnpm --filter @sanctuary/api test`.
  - Run `pnpm lint && pnpm format:check`.
  - Run `pnpm --filter @sanctuary/e2e test -- --project=cdp` (requires network).
  - Run `pnpm --filter @sanctuary/e2e test -- --project=api` (requires API + seed data).
  - Run `pnpm --filter @sanctuary/e2e test -- --project=ui` (requires API + web servers).
  - Automation script: `scripts/run-manual-verification-phase-3.sh`.

## Phase 4: Documentation [COMPLETED]

**Goal:** Document the shipped feature (backend params, frontend behavior, and operational notes).

- [x] Task: Documentation Update
  - [x] Document the `packages/scraper` API and usage.
  - [x] Document the structure of the scraped poem data in `packages/shared`.
  - [x] Document rate limiting and checkpointing strategies used for each source.
  - [x] Update `docs/plans/001-data-pipeline-plan.md` to reflect the completed scraper implementation.
