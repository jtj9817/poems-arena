---
audit_file: 20260225_duel_assembly_api_updates_20260224_audit.md
project_name: duel_assembly_api_updates_20260224
last_audited_commit: a693260
last_audit_date: 2026-02-26
total_phases: 4
total_commits: 34
---

# Phase Commit Audit — duel_assembly_api_updates_20260224

## Quick Summary

### Phase 0: Track Planning & Specification (13 docs commits, 2026-02-25)

Established the complete contract for Phase 5 — Duel Assembly & API Updates. Iteratively refined the conductor plan and spec across 9 commits covering auto-pairing model, featured_duels schema, API endpoint contracts, error envelope standardization, test/coverage requirements, and plan-document alignment. No code changes.

### Phase 1: Database Schema Updates (2 implementation commits, 2026-02-25) ✅ COMPLETE [checkpoint: 956c53a]

Added `featured_duels` table to `@sanctuary/db` Drizzle schema with autoincrement PK, FK to `duels.id`, non-unique indexes on `featured_on` and `duel_id`, and UTC timestamp default. Migration applied to Turso via `db:push`. Schema test and schema contract docs included. Verified with 8-check manual script.
Follow-up hardening: manual verification now runs rollback-only inside an isolated LibSQL database; config/docs migrated to `LIBSQL_AUTH_TOKEN` (legacy fallback preserved).

### Phase 2: Duel Assembly Logic (2 implementation commits, 2026-02-25) ✅ COMPLETE [checkpoint: 7e3baf5]

Implemented full duel assembly system in `packages/ai-gen`: pure functional core (`assemblePairs`) and DB orchestration layer (`assembleAndPersistDuels`). Pairs HUMAN↔AI poems by shared topic with deterministic duel IDs (SHA-256 hash of sorted poem IDs, 12-char hex prefix), bounded fan-out (default 10), pseudo-random topic selection seeded by poem IDs, idempotent `INSERT OR IGNORE` persistence, and deterministic A/B position assignment. Integrated as optional `assembleAfterRun` hook in the AI generation CLI. Fixed `persistDuelCandidates` to report actual inserted row counts from `rowsAffected` rather than attempted candidate counts. Verified with 16-check manual script (Sections A–D).

### Phase 3: API Updates (2 implementation commits, 2026-02-25) ✅ COMPLETE [checkpoint: 13c4f93]

Refactored `apps/api/src/routes/duels.ts` into a `createDuelsRouter(db)` factory for testability. Added `apps/api/src/errors.ts` with `ApiError` base class and three subclasses (`DuelNotFoundError`, `InvalidPageError`, `EndpointNotFoundError`) producing stable `{ error, code }` JSON envelopes. Updated all three active duel endpoints: `GET /duels` adds `topicMeta` via topics JOIN with null fallback + `page` validation (400 INVALID_PAGE); `GET /duels/today` removed and replaced with 404 ENDPOINT_NOT_FOUND; `GET /duels/:id` logs every call to `featured_duels` with graceful degradation when the table is absent; `GET /duels/:id/stats` adds `topicMeta` and per-poem `sourceInfo` (primary + provenances from `scrape_sources` fetched in a single batch). Added router-level and app-level `onError` middleware. Added 23-test route suite with in-memory LibSQL (97.92% line coverage). Verified with 22-check manual script.

### Phase 4: Regression & Quality Gate (1 implementation commit, 2026-02-25) ✅ COMPLETE [checkpoint: c9856f1]

Implemented the full Phase 4 regression gate for duel assembly and duel APIs. Added new route-level regression tests for positive page handling, multi-duel-per-day retrieval, and strict error-envelope validation. Added ai-gen CLI regression that proves a generation run plus assembly persists duel rows. Added a hard coverage-gate script (`coverage:phase4`) enforcing module and package thresholds for `@sanctuary/api` and `@sanctuary/ai-gen`, plus a dedicated manual verification runner script for the full Phase 4 flow. Phase 4 tasks were recorded and checkpointed in the conductor plan with a verification note attached to the checkpoint commit.

---

## Phase 0: Track Planning & Specification

### Overview

- **Commits**: 9 docs commits (filtered as non-implementation)
- **Lines Changed**: +176, -36 across plan.md and spec.md
- **Files Affected**: 3 files (`plan.md`, `spec.md`, `docs/plans/001-data-pipeline-plan.md`)
- **Test Coverage**: N/A (documentation only)
- **Migrations**: 0

These commits refined the track contract before any implementation began. Included for completeness; excluded from implementation stats.

### Docs Commits (chronological)

**4873e39** — docs(conductor): align phase 5 duel tracking

- Introduced Phase 5 plan and spec scaffold
- Established `featured_duels` tracking table concept and multi-duel-per-day behavior
- Replaced daily single-duel assumptions with API-by-id retrieval model

**dc5e283** — docs(conductor): refine phase 5 auto-pairing model

- Added many-duels-per-poem pairing strategy
- Specified unordered pair uniqueness (`A/B` == `B/A`) and idempotent reruns
- Added bounded fan-out and deterministic candidate selection requirements

**637a17d** — docs(conductor): deprecate duels today endpoint

- Formally removed `GET /duels/today` from active API contract
- Required `ENDPOINT_NOT_FOUND` (HTTP 404) for removed/deprecated routes

**c8c0b98** — docs(conductor): specify phase 5 API response contracts

- Defined `topicMeta: { id, label }` shape for `GET /duels` and `GET /duels/:id/stats`
- Specified `sourceInfo.primary` and `sourceInfo.provenances` for per-poem attribution
- Added Drizzle query requirements: topic JOIN, scrape_sources batch fetch to avoid N+1

**0d79814** — docs(conductor): harden phase 5 test and error contracts

- Locked `400` payload shape: `{ error: string, code: 'INVALID_PAGE' }`
- Locked `404` payload shape: `{ error: 'Duel not found', code: 'DUEL_NOT_FOUND' }`
- Required >=85% statement/branch coverage for `duels.ts` route, >=90% for duel-assembly module

**ab13429** — docs(conductor): standardize phase 5 API error envelope

- Mandated stable `{ error: string, code: string }` envelope for all Phase 5 error responses
- Defined canonical codes: `INVALID_PAGE`, `DUEL_NOT_FOUND`, `ENDPOINT_NOT_FOUND`
- Required Hono global error handling middleware for consistent formatting

**a28ce26** — docs(conductor): finalize phase 5 topic and 404 rules

- Made multi-topic duel selection deterministic: choose lexicographically smallest shared `topic_id`
- Required skipping pair creation when no shared topic exists
- Pinned deprecated endpoint behavior to HTTP 404 with `ENDPOINT_NOT_FOUND`

**10a9f71** — docs(plans): align phase 5 duel API direction

- Updated `001-data-pipeline-plan.md` to remove daily-rotation assumptions
- Added `featured_duels` schema and Phase 5 success criteria to the plan doc
- Rewrote Phase 5 duel assembly and API contract sections

**3133a14** — docs(conductor): optimize phase 5 assembly and API design

- Introduced deterministic duel IDs (hash of sorted poem IDs) for unordered pair uniqueness
- Specified functional core (`assemblePairs`) pattern separated from DB side-effects
- Required `INSERT ON CONFLICT DO NOTHING` for bulk duel insertions
- Added pseudo-random topic selection (seeded by poem IDs) to avoid alphabetical skew

### Breaking Changes

None (documentation phase)

### Technical Debt Introduced

None

---

## Phase 1: Database Schema Updates

### Overview

- **Commits**: 2 implementation commits + 1 manual verification script + 3 conductor/plan bookkeeping commits
- **Lines Changed**: +658, -144 (net, across all Phase 1 commits including script)
- **Files Affected**: 21 files
- **Test Coverage**: 2/2 implementation commits ✅ (100%)
- **Migrations**: 1 (applied via `db:push` to Turso)

### Implementation Commits

**269d895** — feat(db): add featured_duels table with non-unique indexes
**Impact**: +70/-2 lines, 3 files

- **Schema** (`packages/db/src/schema.ts`): Added `featuredDuels` table definition
  - Columns:
    - `id`: `INTEGER PRIMARY KEY AUTOINCREMENT`
    - `duel_id`: `TEXT NOT NULL REFERENCES duels(id)`
    - `featured_on`: `TEXT NOT NULL` — UTC date in `YYYY-MM-DD` format
    - `created_at`: `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` — UTC timestamp
  - Indexes (both non-unique):
    - `featured_duels_featured_on_idx` on `featured_on`
    - `featured_duels_duel_id_idx` on `duel_id`
  - Added `index` import from `drizzle-orm/sqlite-core`
  - Added `FeaturedDuel` inferred type export: `typeof featuredDuels.$inferSelect`

- **Test** (`packages/db/src/schema.test.ts`): Added `featuredDuels` export presence test
  - Import: added `featuredDuels` to named imports
  - Test: `'exports featuredDuels table'` — asserts `expect(featuredDuels).toBeDefined()`
  - Written as failing test first (Red), then passed after implementation (Green)
  - All 17 tests pass after change

- **Docs** (`docs/backend/featured-duels-schema.md`): New schema contract document
  - Column table with types, constraints, and descriptions
  - Index table (both marked non-unique)
  - Cardinality rules: append-only, no uniqueness on `(duel_id, featured_on)`, global not user-scoped
  - Lifecycle note: row inserted on every `GET /duels/:id` call

- **Migration**: Applied to Turso via `pnpm --filter @sanctuary/api db:push`
  - Confirmed `[✓] Changes applied`
  - Smoke-checked: two rows with same `duel_id` + same `featured_on` inserted and retrieved successfully

**900c45d** — fix(manual-tests): make duel verification rollback-only
**Impact**: +236/-124 lines, 17 files

- **Manual verification safety** (`scripts/verify-phase1-duel-assembly.ts`):
  - Runs against an isolated manual-test LibSQL database (defaults to a temp `file:` URL).
  - Wraps all write checks in a single `write` transaction and always `ROLLBACK`s in `finally` (no persistent DB writes).
  - Removes explicit cleanup deletes; prevents deleting unintended rows even under concurrency.
- **Deterministic ID capture**: uses `INSERT ... RETURNING id` instead of `ORDER BY id DESC LIMIT 2`.
- **Exit reliability**: closes `db.$client` in `finally` to prevent hanging after completion.
- **Env var rename**:
  - `packages/db/src/config.ts` now reads `LIBSQL_AUTH_TOKEN` / `LIBSQL_TEST_AUTH_TOKEN` (falls back to legacy `LIBSQL_AGILIQUILL_TOKEN` / `LIBSQL_TEST_AGILIQUILL_TOKEN`).
  - Updated `apps/api/drizzle.config.ts`, manual verification scripts, and docs to match the new env var names.

### Conductor / Bookkeeping Commits

**e1405e0** — test(scripts): add Phase 1 duel assembly manual verification script
**Impact**: +334 lines, 1 file

- **Script** (`scripts/verify-phase1-duel-assembly.ts`): 8-check manual verification script
  - Pattern: matches existing `scripts/verify-phase3-ai-gen.ts` convention (inline helpers, `runCheck`, timestamped log file)
  - Checks:
    1. Setup: required files exist (`schema.ts`, `schema.test.ts`, `featured-duels-schema.md`)
    2. Execution: `featuredDuels` export is a non-null object
    3. Execution: `@sanctuary/db` test suite exits 0 with `CI=true`
    4. Execution: Drizzle client connects to Turso
    5. Execution: `featured_duels` table exists in `sqlite_master`
    6. Execution: same-day same-duel duplicate inserts both succeed
    7. Execution: both inserted rows retrievable via `SELECT`
    8. Cleanup: test rows deleted by ID
  - DB access via `db.$client.execute()` (raw LibSQL) — avoids root-level `drizzle-orm` import issue with pnpm workspace layout
  - Production guard: `process.env.NODE_ENV === 'production'` throws immediately
  - All 8/8 checks passed on first run
  - Follow-up hardening landed in **900c45d** (rollback-only transaction + isolated DB)

**65925ba** — conductor(plan): Mark task 'Add featured_duels table' as complete

- Updated all sub-task checkboxes to `[x]`; recorded commit SHA `269d895`

**956c53a** — conductor(checkpoint): Checkpoint end of Phase 1 — Database Schema Updates

- Phase 1 checkpoint commit with git note containing full verification report (17 automated + 8 manual checks)

**6b9ddf7** — conductor(plan): Mark phase 'Phase 1: Database Schema Updates' as complete

- Appended `[checkpoint: 956c53a]` to Phase 1 heading in plan.md

### Breaking Changes

None

### Technical Debt Introduced

None

---

## Phase 2: Duel Assembly Logic

### Overview

- **Commits**: 2 implementation commits + 1 manual verification script + 4 conductor/plan bookkeeping commits
- **Lines Changed**: +1,075, -30 (net, across all Phase 2 commits including script)
- **Files Affected**: 6 files
- **Test Coverage**: 2/2 implementation commits ✅ (100%)
- **Migrations**: 0

### Implementation Commits

**d3e3419** — feat(ai-gen): implement duel assembly logic with auto-pairing
**Impact**: +952/-2 lines, 5 files

- **Module**: Created `packages/ai-gen/src/duel-assembly.ts`
  - **Exported types**: `TopicInfo { id, label }`, `PoemWithTopics { id, type, topics[] }`, `DuelCandidate { id, poemAId, poemBId, topic, topicId }`, `AssemblePairsOptions`, `PersistenceDb`
  - **Pure helpers** (internal):
    - `buildDuelId(poemIdA, poemIdB): string` — SHA-256 of sorted poem IDs, 12-char hex prefix, `duel-` prefixed; symmetric: `buildDuelId(a,b) === buildDuelId(b,a)`
    - `seedFromPoemIds(poemIdA, poemIdB): number` — reads UInt32BE from SHA-256 hash of sorted poem pair; used for deterministic but non-alphabetical selection
    - `selectSharedTopic(sharedTopics, humanPoemId, aiPoemId): TopicInfo` — sorts topics by `id`, picks `sorted[seed % length]` to avoid alphabetical skew across different pairs
    - `assignPositions(humanPoemId, aiPoemId): { poemAId, poemBId }` — uses `seed % 2` to randomise HUMAN/AI A/B slot; stable across reruns for the same pair
  - **Functional core**: `assemblePairs(options): DuelCandidate[]`
    - Builds `aiByTopicId` Map for O(1) topic intersection
    - Per HUMAN poem: collects distinct eligible AI poems sharing ≥1 topic, sorts by AI poem ID (deterministic), caps at `maxFanOut` (default 10)
    - Per pair: resolves shared topics, selects one via seeded index, builds `duelId`, skips if in `seenThisRun` (union of `existingDuelIds` + in-batch seen set), calls `assignPositions`, pushes `DuelCandidate`
  - **DB fetch functions**:
    - `fetchPoemsWithTopics(db): Promise<PoemWithTopics[]>` — `SELECT p.id, p.type, pt.topic_id, t.label` with `INNER JOIN poem_topics + topics`, groups rows by `poem_id` into `PoemWithTopics` objects; skips rows with null `id`, `type`, `topic_id`, or `topic_label`
    - `fetchExistingDuelIds(db): Promise<Set<string>>` — `SELECT id FROM duels`; returns Set for O(1) idempotency checks
  - **DB persistence**:
    - `persistDuelCandidates(db, candidates): Promise<number>` — per-candidate `INSERT OR IGNORE INTO duels (id, topic, topic_id, poem_a_id, poem_b_id) VALUES (?, ?, ?, ?, ?)`; initially returned `candidates.length` (fixed in **3865c0d**)
  - **Orchestrator**: `assembleAndPersistDuels(db, options?): Promise<{ totalCandidates, newDuels }>` — fans out to `fetchPoemsWithTopics` + `fetchExistingDuelIds` in parallel via `Promise.all`, calls `assemblePairs`, calls `persistDuelCandidates`, returns counts

- **CLI integration**: Modified `packages/ai-gen/src/cli.ts`
  - Added `assembleAfterRun?: () => Promise<AssemblyRunResult>` optional hook to `CliDependencies` interface
  - Added `AssemblyRunResult { totalCandidates: number; newDuels: number }` interface
  - Added `assemblyResult?: AssemblyRunResult` field to `CliRunSummary`
  - `runGenerationCli` calls `assembleAfterRun` (if present) in both early-exit (0 poems) and normal completion paths; errors are caught and logged without propagating

- **Entry point**: Modified `packages/ai-gen/src/index.ts`
  - New exports from `./duel-assembly`: `assemblePairs`, `assembleAndPersistDuels`, `fetchPoemsWithTopics`, `fetchExistingDuelIds`, `persistDuelCandidates`, `DuelCandidate`, `PoemWithTopics`, `TopicInfo`, `AssemblePairsOptions`
  - New exports from `./cli`: `AssemblyRunResult`
  - `createDefaultCliDependencies`: wires `assembleAfterRun: async () => assembleAndPersistDuels(persistenceDb)` into returned `CliDependencies`
  - Bumped `AI_GEN_VERSION` to `0.2.0`

- **Tests**: `packages/ai-gen/src/duel-assembly.test.ts` — 19 unit tests across 5 `describe` blocks
  - `assemblePairs` (11 tests): many-duels-per-poem, duplicate prevention, unordered pair uniqueness, topic/topicId resolution, seeded topic selection, no-shared-topic skip, A/B position randomisation, idempotency on reruns, `maxFanOut` limit, deterministic fan-out selection, multiple HUMAN poems, empty inputs
  - `fetchPoemsWithTopics` (3 tests): row grouping, empty result, null topic skip
  - `persistDuelCandidates` (3 tests): INSERT OR IGNORE calls, empty candidates, correct column values
  - `fetchExistingDuelIds` (3 tests): Set construction, empty DB, null id skip
  - `assembleAndPersistDuels` (4 tests): full orchestration, zero pairs, duplicate skip, maxFanOut passthrough
  - **Coverage**: `duel-assembly.ts` 100% lines / 95.65% functions; package 94.34%

- **CLI Tests**: `packages/ai-gen/src/cli.test.ts` — 3 new integration tests added
  - `assembleAfterRun hook is called after successful poem processing`
  - `assembleAfterRun hook is called even when no poems are found`
  - `assembleAfterRun errors are caught and do not fail the run`

**3865c0d** — fix(ai-gen): count only inserted duel rows
**Impact**: +64/-18 lines, 3 files

- **Bug fix** (`packages/ai-gen/src/duel-assembly.ts`):
  - `PersistenceDb.execute` return type: added `rowsAffected?: number` field to the interface
  - `persistDuelCandidates`: switched from returning `candidates.length` (attempted count) to summing `result.rowsAffected` per INSERT call — `INSERT OR IGNORE` skips return `rowsAffected: 0`, inserts return `rowsAffected: 1`; uses `Math.max(0, Math.trunc(result.rowsAffected))` to guard against unexpected values
  - Updated JSDoc: "Returns the number of rows actually inserted."

- **Adapter fix** (`packages/ai-gen/src/index.ts`):
  - `createDefaultCliDependencies` raw LibSQL client type: added `rowsAffected?: number` to the execute return type annotation
  - `persistenceDb.execute` now passes through `rowsAffected: result.rowsAffected` to callers (previously returned `{ rows }` only)

- **Tests** (`packages/ai-gen/src/duel-assembly.test.ts`):
  - Upgraded `createMockDb` helper: accepts `Array<Array<Record<string, unknown>> | MockDbResult>` so callers can specify `rowsAffected`; added `MockDbResult` type
  - Updated existing `persistDuelCandidates` tests to pass `{ rows: [], rowsAffected: 1 }` result objects
  - New test: `'counts only successfully inserted rows when INSERT OR IGNORE skips duplicates'` — two candidates with `rowsAffected: 1` and `rowsAffected: 0` respectively → asserts count is `1`
  - Updated `assembleAndPersistDuels` tests to use `rowsAffected`-bearing mock results

### Conductor / Bookkeeping Commits

**2c199b7** — test(scripts): add Phase 2 duel assembly manual verification script
**Impact**: +760 lines, 1 file

- **Script** (`scripts/verify-phase2-duel-assembly.ts`): 16-check manual verification script (Sections A–D)
  - Pattern: matches Phase 1 verification convention (isolated LibSQL DB, rollback-only transaction, `TestLogger`/`TestAssertion` helpers, timestamped log file)
  - Section A (file-system, 3 checks): `duel-assembly.ts` exists, `duel-assembly.test.ts` exists, `assemblePairs`/`assembleAndPersistDuels` are exported functions
  - Section B (pure function, 8 checks): basic pairing, no-shared-topic, unordered pair uniqueness, many-duels-per-poem (3 candidates), fan-out cap, fan-out determinism by sorted ID, idempotency via `existingDuelIds`, A/B position stability across reruns
  - Section C (automated suite, 1 check): `pnpm --filter @sanctuary/ai-gen test` exits 0 with `CI=true`
  - Section D (DB integration, 4 checks): create isolated SQLite DB with schema via `db:push`, seed topics/poems/poem_topics, assert `assembleAndPersistDuels` produces ≥1 candidate and ≥1 new duel, idempotency rerun, verify duel row fields and topic references, deterministic ID match between pure function and DB row, no-shared-topic pair absent from DB
  - Transaction: all write checks run inside a LibSQL `write` transaction that is always `ROLLBACK`ed in `finally`
  - Initial D3 check used `>= 1` assertions (hardened in **1d596bc**)

**1d596bc** — fix(scripts): harden phase2 duel checks
**Impact**: +28/-9 lines, 1 file

- **`runCheck` hardening** (`scripts/verify-phase2-duel-assembly.ts`):
  - Added `getAssertionFailureCount()` helper to read `TestAssertion.failed` counter via type cast
  - `runCheck` now snapshots failure count before/after `fn()`; if `failuresAfter > failuresBefore` it logs a `FAIL` entry and returns `false` — catches silent assertion failures that do not throw
- **D3 assertion tightening**: weakened `>= 1` assertions replaced with exact `assertEquals(3, ...)` checks:
  - `totalCandidates === 3` (human-A↔ai-A + human-A↔ai-B + human-X↔ai-X)
  - `newDuels === 3`
  - `dbCount === 3`

**b848eff** — conductor(plan): Mark task 'Implement Auto-Pairing in packages/ai-gen' as complete
**a0479b9** — conductor(plan): Mark task 'Conductor - User Manual Verification Phase 2' as complete
**277a5b3** — conductor(plan): Mark phase 'Phase 2: Duel Assembly Logic' as complete
**7e3baf5** — conductor(checkpoint): Checkpoint end of Phase 2 — Duel Assembly Logic

### Breaking Changes

None

### Technical Debt Introduced

None

---

## Phase 3: API Updates

### Overview

- **Commits**: 2 implementation commits + 1 manual verification script + 5 conductor/plan bookkeeping commits
- **Lines Changed**: +854, -110 (net, across implementation commits only)
- **Files Affected**: 5 files
- **Test Coverage**: 2/2 implementation commits ✅ (100%)
- **Migrations**: 0

### Implementation Commits

**58affa6** — feat(api): implement Phase 3 API updates — topicMeta, sourceInfo, featured_duels, error contracts
**Impact**: +809/-104 lines, 4 files

- **New file**: `apps/api/src/errors.ts`
  - `ApiError` — base class: `constructor(message, code, statusCode)`; sets `this.name = 'ApiError'`
  - `DuelNotFoundError extends ApiError` — message `'Duel not found'`, code `DUEL_NOT_FOUND`, status `404`
  - `InvalidPageError extends ApiError` — message from caller, code `INVALID_PAGE`, status `400`
  - `EndpointNotFoundError extends ApiError` — message `'Endpoint not found'`, code `ENDPOINT_NOT_FOUND`, status `404`

- **Rewrite**: `apps/api/src/routes/duels.ts` → `createDuelsRouter(db: Db)` factory
  - Module-level `duelsRouter` singleton replaced with exported factory function for test DB injection
  - **`router.onError((err, c) => {...})`** inside the factory: catches `ApiError` subclasses → `c.json({ error, code }, statusCode)`; re-throws non-`ApiError` errors up to the app-level handler
  - **`GET /`** (`GET /duels`):
    - Added `LEFT JOIN topics ON duels.topic_id = topics.id` to Drizzle query
    - Selects `topicId: duels.topicId`, `topicLabel: topics.label`
    - Maps each row through `buildTopicMeta(topicId, topicLabel, duel.topic)` → `topicMeta: { id, label }`
    - `parsePage(raw)` helper validates `page` query param: throws `InvalidPageError` for `0`, negative, non-integer (`1.5`), non-numeric (`abc`)
  - **`GET /today`** (registered before `/:id` to take priority):
    - Throws `EndpointNotFoundError()` — returns `404 { error: 'Endpoint not found', code: 'ENDPOINT_NOT_FOUND' }`
  - **`GET /:id`**:
    - Fetches duel row; throws `DuelNotFoundError` if not found
    - Fetches both poem rows in `Promise.all`; throws `DuelNotFoundError` if either is absent
    - Inserts row into `featured_duels` (`duelId`, `featuredOn = today`) on every successful call
    - Returns anonymous payload: `{ id, topic, poemA: { id, title, content }, poemB: { id, title, content } }` — no `author` or `type`
  - **`GET /:id/stats`**:
    - Fetches duel row with `LEFT JOIN topics` for `topicMeta`
    - Fetches both poem rows in `Promise.all`; throws `DuelNotFoundError` if either is absent
    - Batch-fetches `scrape_sources` for both poem IDs in a single query: `WHERE poem_id IN (poemA.id, poemB.id) ORDER BY scraped_at DESC` — avoids N+1
    - Groups scrape rows into `Map<poemId, ScrapeRow[]>` for O(1) per-poem lookup
    - `buildSourceInfo(poem, sourcesByPoem)` helper: returns `{ primary: { source, sourceUrl }, provenances: [{ source, sourceUrl, scrapedAt, isPublicDomain }] }`
    - `computeAvgReadingTime(contentA, contentB)` helper: splits combined content on whitespace, applies 200 wpm rate: `${m}m ${s}s`
    - Returns `{ humanWinRate, avgReadingTime, duel: { id, topic, topicMeta, poemA: { id, title, content, author, type, year, sourceInfo }, poemB: {...} } }`
  - **Helpers added**:
    - `parsePage(raw): number` — returns `1` if undefined; throws `InvalidPageError` for invalid values
    - `buildTopicMeta(topicId, topicLabel, duelTopic)` — returns `{ id: topicId, label: topicLabel }` on join hit; `{ id: null, label: duelTopic }` on miss
    - `buildSourceInfo(poem, sourcesByPoem)` — constructs primary + provenances struct
    - `computeAvgReadingTime(contentA, contentB)` — computes reading time from word count
    - `isMissingFeaturedDuelsTableError(error)` — added in follow-up commit **d64da75** (see below)

- **Modified**: `apps/api/src/index.ts`
  - Import: replaced `duelsRouter` with `{ createDuelsRouter }` and added `{ db }` and `{ ApiError }`
  - Route mount: `app.route('/api/v1/duels', createDuelsRouter(db))`
  - Added `app.onError((err, c) => {...})`: formats `ApiError` subclasses as `{ error, code }` JSON; logs and returns `500 { error: 'Internal server error', code: 'INTERNAL_ERROR' }` for all others

- **New file**: `apps/api/src/routes/duels.test.ts` — 22 route-level unit tests
  - Test setup: `createTestApp(db)` mounts the router on a bare `new Hono()` for isolated testing
  - `createTestDb(opts?)` utility: spins up anonymous in-memory LibSQL SQLite (`file::memory:`), runs DDL for all tables including optional `featured_duels` via `db.$client.execute()`
  - Tests by section:
    - `GET /duels` (5 tests): topicMeta join present, topicMeta fallback on null topic_id, 400 INVALID_PAGE for page=0/-1/1.5/abc
    - `GET /duels/today` (1 test): 404 ENDPOINT_NOT_FOUND
    - `GET /duels/:id` (5 tests): 200 with anonymous payload (no author/type), 404 DUEL_NOT_FOUND on missing duel, 404 DUEL_NOT_FOUND on missing poem, featured_duels logging (2 calls → 2 rows), FK PRAGMA OFF workaround for poem deletion
    - `GET /duels/:id/stats` (9 tests): 404 DUEL_NOT_FOUND on missing duel, 404 DUEL_NOT_FOUND on missing poem, topicMeta join, empty AI provenances, sourceInfo.primary from poems.source, provenances count, provenances DESC sort order, humanWinRate, avgReadingTime
    - Missing featured_duels table (1 test): added in **d64da75** below
  - Coverage: `duels.ts` 97.92% lines / 100% functions (threshold: 85%); `@sanctuary/api` package 90.92% lines overall

**d64da75** — fix(api): keep duel reads resilient without log table
**Impact**: +45/-6 lines, 2 files

- **Bug fix** (`apps/api/src/routes/duels.ts`):
  - Wrapped `featured_duels` INSERT in `try/catch` inside `GET /:id` handler
  - Added `isMissingFeaturedDuelsTableError(error): boolean` helper:
    - Returns `false` if `error` is not an `Error` instance
    - Extracts `error.cause.message` (or string cause) into `causeMessage`
    - Returns `true` if `combinedMessage` includes both `'no such table'` and `'featured_duels'` (case-insensitive)
  - On catch: re-throws unless error matches `isMissingFeaturedDuelsTableError` — allows forward-compatibility when deploying API before `featured_duels` migration runs

- **Test** (`apps/api/src/routes/duels.test.ts`):
  - Added `includeFeaturedDuelsTable` option to `createTestDb` helper
  - New test: `'still returns duel payload when featured_duels table does not exist'` — creates DB without `featured_duels`, asserts `GET /:id` returns `200` with correct `id`
  - Total test count after this commit: 23

### Conductor / Bookkeeping Commits

**b54d90c** — test(scripts): add Phase 3 API updates manual verification script
**Impact**: +794 lines, 1 file

- **Script** (`scripts/verify-phase3-api-updates.ts`): 22-check manual verification script (Sections A–F)
  - Pattern: matches Phase 1/2 verification convention (`runCheck`, `TestLogger`/`TestAssertion` helpers, timestamped log file)
  - Uses `createDb` from `packages/db/src/client` (avoids direct `@libsql/client` import; pnpm strict workspace isolation)
  - Uses `createDuelsRouter(db).fetch(new Request(...))` — Hono routers expose `.fetch()` directly without needing `new Hono()` at the script level
  - In-memory DBs via `createDb({ url: 'file::memory:' })` — each connection is already isolated; no `?cache=` suffix needed
  - Section A (4 checks): `errors.ts` exists, `duels.ts` exists, `duels.test.ts` exists, `createDuelsRouter` is a function
  - Section B (6 checks): `GET /duels` topicMeta join, topicMeta null fallback, INVALID_PAGE for page=0/-1/1.5/abc
  - Section C (1 check): `GET /duels/today` → 404 ENDPOINT_NOT_FOUND
  - Section D (5 checks): anonymous payload (no author/type), featured_duels logging (2 rows after 2 calls), DUEL_NOT_FOUND for missing duel, DUEL_NOT_FOUND when poem row deleted, graceful degradation without featured_duels table
  - Section E (5 checks): DUEL_NOT_FOUND for unknown stats id, topicMeta in stats, sourceInfo.primary + provenances, provenances DESC sort (newest first), DUEL_NOT_FOUND when poem deleted for stats
  - Section F (1 check): `pnpm --filter @sanctuary/api test` exits 0 with `CI=true`

**74a8a16** — fix(scripts): fail phase3 verify on check errors
**Impact**: +10/-2 lines, 1 file

- **`main()` result logic** (`scripts/verify-phase3-api-updates.ts`):
  - Split `TestAssertion.summary()` result into `assertionsPassed` and added `checksPassed = failed === 0`
  - `allPassed = assertionsPassed && checksPassed` — prevents false-pass when a check throws before reaching any assertion
  - Updated result line: `✗ N CHECKS FAILED` with optional `(assertions)` suffix when assertion totals also fail

**e99fe8c** — conductor(plan): Mark Phase 3 API Update tasks as complete
**13c4f93** — conductor(checkpoint): Checkpoint end of Phase 3 — API Updates
**9ee71b5** — conductor(plan): Mark phase 'Phase 3: API Updates' as complete

### Breaking Changes

None

### Technical Debt Introduced

None

---

## Phase 4: Regression & Quality Gate

### Overview

- **Commits**: 1 implementation commit + 3 conductor/plan bookkeeping commits
- **Lines Changed**: +485, -18 (across all Phase 4 commits)
- **Files Affected**: 6 files
- **Test Coverage**: 1/1 implementation commits ✅ (100%)
- **Migrations**: 0

### Implementation Commits

**520d823** — test(duel-api): implement phase 4 regression and quality gates  
**Impact**: +467/-0 lines, 5 files

- **API regression tests** (`apps/api/src/routes/duels.test.ts`):
  - Added positive page validation (`page=2`) coverage.
  - Added explicit multi-duel-per-day serving validation using `GET /duels` + `GET /duels/:id`.
  - Added grouped error-envelope regression assertions covering `INVALID_PAGE`, `ENDPOINT_NOT_FOUND`, and `DUEL_NOT_FOUND` paths with strict `{ error, code }` shape checks.
- **AI generation regression test** (`packages/ai-gen/src/cli.test.ts`):
  - Added integration-style test using in-memory SQLite to verify that running the generation flow with `assembleAfterRun` actually persists duel rows.
  - Verifies resulting duel topic and poem IDs, and that assembly logging is emitted.
- **Coverage CI gate** (`scripts/check-phase4-coverage-gate.mjs`):
  - New script runs `bun test --coverage --coverage-reporter=lcov` for `@sanctuary/api` and `@sanctuary/ai-gen`.
  - Parses `lcov.info` and enforces:
    - `apps/api/src/routes/duels.ts` >=85 (line/function; branch if available)
    - `packages/ai-gen/src/duel-assembly.ts` >=90 (line/function; branch if available)
    - package `src/` floor >=80 for both packages.
  - Handles Bun branch-metric omission (`BRF/BRH`) by warning and enforcing function coverage as proxy.
- **Manual verification runner** (`scripts/run-manual-verification-phase-4-duel-assembly-api-updates.sh`):
  - Added single entry-point script to run coverage gate, lint, format check, route regressions, and ai-gen duel regression tests with timestamped logs.
- **Script wiring** (`package.json`):
  - Added `coverage:phase4` and `quality:phase4` scripts.
  - Left root `test` unchanged (`pnpm -r --if-present test`) so existing e2e baseline behavior is preserved.

### Conductor / Bookkeeping Commits

**ca8c767** — conductor(plan): Mark Phase 4 Regression & Quality Gate tasks as complete

- Recorded `(520d823)` against all Phase 4 task lines in `conductor/tracks/duel_assembly_api_updates_20260224/plan.md`.

**c9856f1** — conductor(checkpoint): Checkpoint end of Phase 4 — Regression & Quality Gate

- Created Phase 4 checkpoint commit and attached a detailed verification report as a git note (coverage gate outputs, manual verification commands, and user confirmation).

**a693260** — conductor(plan): Mark phase 'Phase 4: Regression & Quality Gate' as complete

- Updated Phase 4 heading with `[checkpoint: c9856f1]` in `plan.md`.

### Breaking Changes

None

### Technical Debt Introduced

None

---

## Database Evolution

### Schema Changes

- **269d895** (2026-02-25): Created `featured_duels` table
  - Columns: `id` (INTEGER AUTOINCREMENT PK), `duel_id` (TEXT NOT NULL FK → `duels.id`), `featured_on` (TEXT NOT NULL), `created_at` (TEXT NOT NULL default UTC timestamp)
  - Indexes: `featured_duels_featured_on_idx` on `featured_on` (non-unique), `featured_duels_duel_id_idx` on `duel_id` (non-unique)
  - Cardinality: no uniqueness constraint on `(duel_id, featured_on)` — duplicates intentionally allowed
  - Migration applied: `db:push` → Turso (libsql://sanctuary-of-poetical-machines-db-joshj-dev.aws-us-west-2.turso.io)

---

## File Change Heatmap

Most modified files across all commits (excluding documentation-only):

- `conductor/tracks/duel_assembly_api_updates_20260224/plan.md`: 20 commits (Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 bookkeeping)
- `conductor/tracks/duel_assembly_api_updates_20260224/spec.md`: 7 commits (Phase 0)
- `apps/api/src/routes/duels.ts`: 2 commits (Phase 3) — full rewrite + graceful degradation fix
- `apps/api/src/routes/duels.test.ts`: 3 commits (Phase 3 + Phase 4) — initial suite, featured_duels absence test, and regression gate expansions
- `scripts/verify-phase3-api-updates.ts`: 2 commits (Phase 3) — new script + pass/fail fix
- `packages/ai-gen/src/duel-assembly.test.ts`: 2 commits (Phase 2) — test file upgraded in fix
- `packages/ai-gen/src/duel-assembly.ts`: 2 commits (Phase 2) — new file + rowsAffected fix
- `packages/ai-gen/src/index.ts`: 2 commits (Phase 2) — exports + adapter fix
- `scripts/verify-phase2-duel-assembly.ts`: 2 commits (Phase 2, new file + hardening)
- `packages/db/src/schema.ts`: 1 commit (Phase 1) — core schema change
- `packages/db/src/schema.test.ts`: 1 commit (Phase 1)
- `packages/ai-gen/src/cli.ts`: 1 commit (Phase 2) — assembleAfterRun hook
- `packages/ai-gen/src/cli.test.ts`: 2 commits (Phase 2 + Phase 4) — assembleAfterRun integration tests + DB-persistence regression
- `scripts/verify-phase1-duel-assembly.ts`: 1 commit (Phase 1, new file)
- `docs/backend/featured-duels-schema.md`: 1 commit (Phase 1, new file)
- `docs/plans/001-data-pipeline-plan.md`: 1 commit (Phase 0 docs alignment)
- `apps/api/src/errors.ts`: 1 commit (Phase 3) — new error hierarchy
- `apps/api/src/index.ts`: 1 commit (Phase 3) — factory mount + app-level onError
- `scripts/check-phase4-coverage-gate.mjs`: 1 commit (Phase 4) — hard coverage gate
- `scripts/run-manual-verification-phase-4-duel-assembly-api-updates.sh`: 1 commit (Phase 4) — end-to-end Phase 4 runner

---

## Cross-Phase Dependencies

**Phase 2 → pre-existing schema**: `packages/ai-gen/src/duel-assembly.ts` reads `poems`, `poem_topics`, `topics`, and writes `duels` — all tables predating this track.

**Phase 3 → Phase 1**: `GET /duels/:id` in `apps/api/src/routes/duels.ts` INSERTs into `featured_duels` (added in Phase 1) on every successful call. Graceful degradation (`isMissingFeaturedDuelsTableError`) was added to handle pre-migration deployments.

**Phase 4 → Phase 2 & 3**: Regression gate tests extend and exercise components delivered earlier:

- `packages/ai-gen/src/cli.test.ts` validates Phase 2 duel-assembly persistence via generation flow.
- `apps/api/src/routes/duels.test.ts` adds Phase 3 API regression checks for multi-duel serving and standardized error envelopes.

---

## Test Coverage by Phase

**Phase 0**: N/A — docs only
**Phase 1**: 1/1 implementation commits (100%) ✅

- `packages/db/src/schema.test.ts` — `featuredDuels` export presence
- 17 total `@sanctuary/db` tests passing

**Phase 2**: 2/2 implementation commits (100%) ✅

- `packages/ai-gen/src/duel-assembly.test.ts` — 19 unit tests (assemblePairs, fetchPoemsWithTopics, persistDuelCandidates, fetchExistingDuelIds, assembleAndPersistDuels) + 1 new test for rowsAffected duplicate-ignore counting
- `packages/ai-gen/src/cli.test.ts` — 3 new integration tests for the assembleAfterRun hook
- `duel-assembly.ts` coverage: 100% lines / 95.65% functions; package overall: 94.34%

**Phase 3**: 2/2 implementation commits (100%) ✅

- `apps/api/src/routes/duels.test.ts` — 23 route-level unit tests using in-memory LibSQL SQLite; covers topicMeta join + fallback, INVALID_PAGE (0/-1/1.5/abc), ENDPOINT_NOT_FOUND for `/today`, DUEL_NOT_FOUND for missing duel/poem, featured_duels logging (2 rows after 2 calls), graceful degradation without featured_duels table, sourceInfo structure (primary + provenances), provenances DESC sort, humanWinRate, avgReadingTime
- `duels.ts` coverage: 97.92% lines / 100% functions (threshold: 85%); `@sanctuary/api` package overall: 90.92% lines

**Phase 4**: 1/1 implementation commits (100%) ✅

- `apps/api/src/routes/duels.test.ts` extended with regression checks for positive page input, multi-duel-per-day retrieval, and strict `{ error, code }` envelope validation across in-scope failures.
- `packages/ai-gen/src/cli.test.ts` extended with generation+assembly persistence regression using in-memory SQLite.
- `scripts/check-phase4-coverage-gate.mjs` enforces hard coverage thresholds:
  - `apps/api/src/routes/duels.ts`: 98.05% lines / 100.00% functions (>=85 target)
  - `packages/ai-gen/src/duel-assembly.ts`: 100.00% lines / 95.65% functions (>=90 target)
  - package floors: `@sanctuary/api` 98.26% lines / 100.00% functions, `@sanctuary/ai-gen` 92.27% lines / 95.16% functions (>=80 target)
  - branch note: Bun lcov omitted BRF/BRH in this environment; gate warns and uses function coverage as branch proxy.

**Overall**: 6/6 implementation commits (100%) ✅

---

## Rollback Commands

To rollback Phase 4:

```bash
git revert 520d823^..a693260
```

Note: This reverts the Phase 4 regression tests, coverage-gate tooling, and Phase 4 conductor bookkeeping commits.

To rollback Phase 3:

```bash
git revert 58affa6^..74a8a16
```

Note: Phase 3 has no schema changes. Reverting restores the old `duelsRouter` singleton and removes the error class hierarchy, `createDuelsRouter` factory, and all route-level tests.

To rollback Phase 2:

```bash
git revert d3e3419^..1d596bc
```

Note: Phase 2 writes duel rows into the pre-existing `duels` table via `INSERT OR IGNORE`. A schema-level rollback is not required, but duels inserted by `assembleAndPersistDuels` would need to be removed manually if desired.

To rollback Phase 1:

```bash
git revert 269d895^..e1405e0
```

Note: Schema rollback also requires reverting the Turso migration:

```bash
# Drop table manually via Turso CLI or drizzle-kit
turso db shell <db-name> "DROP TABLE IF EXISTS featured_duels;"
```

---

## Statistics

| Metric                 | Value                                                                |
| ---------------------- | -------------------------------------------------------------------- |
| Total commits          | 34 (10 docs, 3 feat, 4 test, 5 fix, 12 conductor)                    |
| Implementation commits | 7 (Phase 1: 2, Phase 2: 2, Phase 3: 2, Phase 4: 1)                   |
| Lines added            | +4,125                                                               |
| Lines removed          | -478                                                                 |
| Files touched          | 38                                                                   |
| New tables             | 1 (`featured_duels`)                                                 |
| New indexes            | 2                                                                    |
| New modules            | 2 (`packages/ai-gen/src/duel-assembly.ts`, `apps/api/src/errors.ts`) |
| Test coverage          | 100%                                                                 |
| Phases completed       | 4 of 5                                                               |
| Track start            | 2026-02-25                                                           |
| Last commit            | 2026-02-25                                                           |

---

## JSON Export

```json
{
  "metadata": {
    "last_commit": "a693260",
    "audit_date": "2026-02-26",
    "total_phases": 4,
    "total_commits": 34,
    "implementation_commits": 7
  },
  "phases": [
    {
      "number": 0,
      "name": "Track Planning & Specification",
      "status": "docs_only",
      "commits": [
        {
          "hash": "4873e39",
          "message": "docs(conductor): align phase 5 duel tracking",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "dc5e283",
          "message": "docs(conductor): refine phase 5 auto-pairing model",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "637a17d",
          "message": "docs(conductor): deprecate duels today endpoint",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "c8c0b98",
          "message": "docs(conductor): specify phase 5 API response contracts",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "0d79814",
          "message": "docs(conductor): harden phase 5 test and error contracts",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "ab13429",
          "message": "docs(conductor): standardize phase 5 API error envelope",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "a28ce26",
          "message": "docs(conductor): finalize phase 5 topic and 404 rules",
          "files_changed": ["plan.md", "spec.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "10a9f71",
          "message": "docs(plans): align phase 5 duel API direction",
          "files_changed": ["docs/plans/001-data-pipeline-plan.md"],
          "has_tests": false,
          "breaking_changes": false
        },
        {
          "hash": "3133a14",
          "message": "docs(conductor): optimize phase 5 assembly and API design",
          "files_changed": ["plan.md"],
          "has_tests": false,
          "breaking_changes": false
        }
      ],
      "stats": { "commits": 9, "files_changed": 3, "migrations": 0, "test_coverage": null }
    },
    {
      "number": 1,
      "name": "Database Schema Updates",
      "status": "complete",
      "checkpoint": "956c53a",
      "commits": [
        {
          "hash": "269d895",
          "message": "feat(db): add featured_duels table with non-unique indexes",
          "files_changed": [
            "packages/db/src/schema.ts",
            "packages/db/src/schema.test.ts",
            "docs/backend/featured-duels-schema.md"
          ],
          "lines_added": 70,
          "lines_removed": 2,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "e1405e0",
          "message": "test(scripts): add Phase 1 duel assembly manual verification script",
          "files_changed": ["scripts/verify-phase1-duel-assembly.ts"],
          "lines_added": 334,
          "lines_removed": 0,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "900c45d",
          "message": "fix(manual-tests): make duel verification rollback-only",
          "files_changed": [
            "scripts/verify-phase1-duel-assembly.ts",
            "packages/db/src/config.ts",
            "apps/api/drizzle.config.ts"
          ],
          "lines_added": 236,
          "lines_removed": 124,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        }
      ],
      "stats": { "commits": 3, "files_changed": 21, "migrations": 1, "test_coverage": 1.0 }
    },
    {
      "number": 2,
      "name": "Duel Assembly Logic",
      "status": "complete",
      "checkpoint": "7e3baf5",
      "commits": [
        {
          "hash": "d3e3419",
          "message": "feat(ai-gen): implement duel assembly logic with auto-pairing",
          "files_changed": [
            "packages/ai-gen/src/duel-assembly.ts",
            "packages/ai-gen/src/duel-assembly.test.ts",
            "packages/ai-gen/src/cli.ts",
            "packages/ai-gen/src/cli.test.ts",
            "packages/ai-gen/src/index.ts"
          ],
          "lines_added": 952,
          "lines_removed": 2,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "2c199b7",
          "message": "test(scripts): add Phase 2 duel assembly manual verification script",
          "files_changed": ["scripts/verify-phase2-duel-assembly.ts"],
          "lines_added": 760,
          "lines_removed": 0,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "3865c0d",
          "message": "fix(ai-gen): count only inserted duel rows",
          "files_changed": [
            "packages/ai-gen/src/duel-assembly.test.ts",
            "packages/ai-gen/src/duel-assembly.ts",
            "packages/ai-gen/src/index.ts"
          ],
          "lines_added": 64,
          "lines_removed": 18,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "1d596bc",
          "message": "fix(scripts): harden phase2 duel checks",
          "files_changed": ["scripts/verify-phase2-duel-assembly.ts"],
          "lines_added": 28,
          "lines_removed": 9,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        }
      ],
      "stats": { "commits": 4, "files_changed": 6, "migrations": 0, "test_coverage": 1.0 }
    },
    {
      "number": 3,
      "name": "API Updates",
      "status": "complete",
      "checkpoint": "13c4f93",
      "commits": [
        {
          "hash": "58affa6",
          "message": "feat(api): implement Phase 3 API updates — topicMeta, sourceInfo, featured_duels, error contracts",
          "files_changed": [
            "apps/api/src/errors.ts",
            "apps/api/src/index.ts",
            "apps/api/src/routes/duels.ts",
            "apps/api/src/routes/duels.test.ts"
          ],
          "lines_added": 809,
          "lines_removed": 104,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "b54d90c",
          "message": "test(scripts): add Phase 3 API updates manual verification script",
          "files_changed": ["scripts/verify-phase3-api-updates.ts"],
          "lines_added": 794,
          "lines_removed": 0,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "d64da75",
          "message": "fix(api): keep duel reads resilient without log table",
          "files_changed": ["apps/api/src/routes/duels.ts", "apps/api/src/routes/duels.test.ts"],
          "lines_added": 45,
          "lines_removed": 6,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        },
        {
          "hash": "74a8a16",
          "message": "fix(scripts): fail phase3 verify on check errors",
          "files_changed": ["scripts/verify-phase3-api-updates.ts"],
          "lines_added": 10,
          "lines_removed": 2,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        }
      ],
      "stats": { "commits": 4, "files_changed": 5, "migrations": 0, "test_coverage": 1.0 }
    },
    {
      "number": 4,
      "name": "Regression & Quality Gate",
      "status": "complete",
      "checkpoint": "c9856f1",
      "commits": [
        {
          "hash": "520d823",
          "message": "test(duel-api): implement phase 4 regression and quality gates",
          "files_changed": [
            "apps/api/src/routes/duels.test.ts",
            "packages/ai-gen/src/cli.test.ts",
            "package.json",
            "scripts/check-phase4-coverage-gate.mjs",
            "scripts/run-manual-verification-phase-4-duel-assembly-api-updates.sh"
          ],
          "lines_added": 467,
          "lines_removed": 0,
          "has_tests": true,
          "breaking_changes": false,
          "technical_debt": []
        }
      ],
      "stats": { "commits": 1, "files_changed": 5, "migrations": 0, "test_coverage": 1.0 }
    }
  ],
  "database": {
    "tables_created": ["featured_duels"],
    "migrations": 1,
    "indexes_added": 2
  },
  "dependencies": [
    {
      "from_phase": 2,
      "to_phase": "pre-existing",
      "tables": ["poems", "poem_topics", "topics", "duels"]
    },
    {
      "from_phase": 3,
      "to_phase": 1,
      "tables": ["featured_duels"],
      "notes": "GET /duels/:id INSERTs into featured_duels; graceful degradation added for pre-migration environments"
    },
    {
      "from_phase": 4,
      "to_phase": [2, 3],
      "files": ["packages/ai-gen/src/cli.test.ts", "apps/api/src/routes/duels.test.ts"],
      "notes": "Regression coverage hardens Phase 2 duel assembly flow and Phase 3 duel API contracts"
    }
  ]
}
```
