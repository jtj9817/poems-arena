# Implementation Plan - Phase 5: Duel Assembly & API Updates

## Phase 1: Database Schema Updates [checkpoint: 956c53a]

- [x] Task: Add `featured_duels` table (269d895)
  - [x] Define the schema contract in docs:
    - [x] `id` autoincrement primary key
    - [x] `duel_id` foreign key to `duels.id`
    - [x] `featured_on` UTC date (`YYYY-MM-DD`)
    - [x] `created_at` UTC timestamp default
  - [x] Define tracking cardinality rules in docs:
    - [x] Multiple featured duel records per day are allowed (global behavior).
    - [x] The same duel can be recorded multiple times on the same day.
  - [x] Add the `featured_duels` table definition to the Drizzle schema in the shared database package.
  - [x] Add non-unique indexes for `featured_on` and `duel_id`.
  - [x] Write/update schema tests for `featured_duels` export presence.
  - [x] Generate and apply database migrations.
  - [x] Verify migration behavior with manual smoke checks:
    - [x] Same day + different duel inserts succeed.
    - [x] Same day + same duel inserts also succeed.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Database Schema Updates' (Protocol in workflow.md) (e1405e0)

## Phase 2: Duel Assembly Logic [checkpoint: 7e3baf5]

- [x] Task: Implement Auto-Pairing in `packages/ai-gen` (d3e3419)
  - [x] Define and document the pairing policy:
    - [x] Many-duels-per-poem model (HUMAN poem can face multiple AI poems in same topic).
    - [x] Unordered pair uniqueness (`A/B` and `B/A` treated as the same pair), enforced via deterministic duel IDs (e.g., hash of sorted poem IDs).
    - [x] Bounded fan-out per HUMAN poem to control scale.
  - [x] Write failing tests for duel assembly behavior:
    - [x] Creates multiple duels for one HUMAN poem when multiple eligible AI poems exist.
    - [x] Prevents duplicate duel creation for an existing unordered pair.
    - [x] Resolves `topic_id`/`topic` from the selected shared topic.
    - [x] Uses a pseudo-random selection (e.g., seeded by poem IDs) when multiple shared topics exist to avoid alphabetical skew.
    - [x] Skips pair creation when no shared topic exists.
    - [x] Randomizes `poem_a` and `poem_b` on first pair creation.
    - [x] Preserves existing orientation and skips insertions on reruns (idempotency).
  - [x] Implement pair candidate selection and assembly logic in `packages/ai-gen`:
    - [x] Extract pairing logic into a pure, testable function `assemblePairs` (Functional Core) separated from database side-effects.
    - [x] Select eligible HUMAN↔AI pairings by shared topic.
    - [x] Ensure deterministic selection order for capped fan-out.
    - [x] Perform bulk database insertions using `INSERT ON CONFLICT DO NOTHING` for optimal performance.
  - [x] Integrate duel assembly step into AI generation completion flow.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Duel Assembly Logic' (Protocol in workflow.md) (2c199b7)

## Phase 3: API Updates

- [x] Task: Promote `GET /duels/:id` as canonical duel retrieval endpoint (58affa6)
  - [x] Write failing tests for anonymous duel retrieval by ID and `featured_duels` logging side effect.
  - [x] Implement/adjust route behavior so multiple duels can be served on the same day without daily lock semantics.
  - [x] Throw custom Error classes (e.g., `NotFoundError`) to trigger a standardized `404` payload `{ error: 'Duel not found', code: 'DUEL_NOT_FOUND' }` when duel exists but references a missing poem row.
  - [x] Remove `GET /duels/today` from `apps/api/src/routes/duels.ts`.
  - [x] Remove/update callers and tests that depend on `GET /duels/today`.
  - [x] Ensure unknown/deprecated duel endpoints return HTTP `404` with `{ error: string, code: 'ENDPOINT_NOT_FOUND' }`.
- [x] Task: Update `GET /duels` and `GET /duels/:id/stats` (58affa6)
  - [x] Define response contracts in tests and docs:
    - [x] `GET /duels` returns `topic` (legacy string) and `topicMeta` object.
    - [x] `GET /duels/:id/stats` returns `duel.topicMeta` and per-poem `sourceInfo`.
  - [x] Define standardized Phase 5 error contract in tests and docs:
    - [x] Implement Hono global error handling middleware to catch custom Error classes and format standardized `{ error: string, code: string }` responses.
    - [x] `INVALID_PAGE`, `DUEL_NOT_FOUND`, and `ENDPOINT_NOT_FOUND` are used consistently.
  - [x] Write failing tests for `GET /duels`:
    - [x] Invalid `page` query values return `400` (`0`, negative, non-integer, non-numeric).
    - [x] `400` payload uses stable shape `{ error: string, code: 'INVALID_PAGE' }`.
    - [x] Includes `topicMeta.id` + `topicMeta.label` when topic join succeeds.
    - [x] Falls back to `topicMeta: { id: null, label: duel.topic }` when `topic_id` is missing/unresolved.
  - [x] Write failing tests for `GET /duels/:id/stats`:
    - [x] Returns `404` payload `{ error: 'Duel not found', code: 'DUEL_NOT_FOUND' }` when duel references missing poem row(s).
    - [x] Includes topic metadata in `duel.topicMeta`.
    - [x] Includes per-poem `sourceInfo.primary` and `sourceInfo.provenances`.
    - [x] Allows AI poems to return empty `sourceInfo.provenances`.
    - [x] Returns `sourceInfo.provenances` sorted by `scrapedAt` descending.
  - [x] Update Drizzle queries in `apps/api/src/routes/duels.ts`:
    - [x] Join `topics` for list and stats responses.
    - [x] Fetch `scrape_sources` for both poem IDs in a single round trip (e.g., using `WHERE poem_id IN (...)` or Drizzle relational queries) to avoid N+1 queries.
    - [x] Map fallback values for missing topic joins and missing scrape rows.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: API Updates' (Protocol in workflow.md)

## Phase 4: Regression & Quality Gate

- [ ] Task: Coverage and Regression Verification
  - [ ] Add route-level unit tests in `apps/api` for `duels` routes (`GET /duels`, `GET /duels/:id`, `GET /duels/:id/stats`) and removed `GET /duels/today`.
  - [ ] Add unit tests in `packages/ai-gen` for duel assembly policy, idempotency, and bounded fan-out behavior.
  - [ ] Ensure `apps/api/src/routes/duels.ts` reaches >=85% statement and branch coverage.
  - [ ] Ensure duel-assembly module in `@sanctuary/ai-gen` reaches >=90% statement and branch coverage.
  - [ ] Ensure package-level coverage floor remains >=80% for both `@sanctuary/ai-gen` and `@sanctuary/api`.
  - [ ] Enforce the coverage thresholds as a hard CI gate (pipeline fails when below threshold).
  - [ ] Execute `pnpm lint` and `pnpm format:check`.
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify that running the AI generator also successfully creates new duels in the database.
  - [ ] Verify repeated calls to `GET /duels/:id` append records to `featured_duels` (including same-day duplicates).
  - [ ] Verify `GET /duels` + `GET /duels/:id` support serving multiple duels per day.
  - [ ] Verify API response edge cases:
    - [ ] Missing `topic_id` still yields stable `topicMeta` fallback.
    - [ ] AI poems return empty provenance arrays without failing stats payload.
    - [ ] All error responses follow `{ error: string, code: string }` across in-scope endpoints.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

- [ ] Task: Documentation Update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 5 completion.
  - [ ] Document the new `featured_duels` schema contract and append-only global tracking behavior.
  - [ ] Document `GET /duels/:id` as the canonical duel retrieval endpoint and `GET /duels/today` deprecation/removal.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Documentation' (Protocol in workflow.md)
