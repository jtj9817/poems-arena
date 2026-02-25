# Implementation Plan - Phase 5: Duel Assembly & API Updates

## Phase 1: Database Schema Updates

- [ ] Task: Add `featured_duels` table
  - [ ] Define the schema contract in docs:
    - [ ] `id` autoincrement primary key
    - [ ] `duel_id` foreign key to `duels.id`
    - [ ] `featured_on` UTC date (`YYYY-MM-DD`)
    - [ ] `created_at` UTC timestamp default
  - [ ] Define tracking cardinality rules in docs:
    - [ ] Multiple featured duel records per day are allowed (global behavior).
    - [ ] The same duel can be recorded multiple times on the same day.
  - [ ] Add the `featured_duels` table definition to the Drizzle schema in the shared database package.
  - [ ] Add non-unique indexes for `featured_on` and `duel_id`.
  - [ ] Write/update schema tests for `featured_duels` export presence.
  - [ ] Generate and apply database migrations.
  - [ ] Verify migration behavior with manual smoke checks:
    - [ ] Same day + different duel inserts succeed.
    - [ ] Same day + same duel inserts also succeed.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Database Schema Updates' (Protocol in workflow.md)

## Phase 2: Duel Assembly Logic

- [ ] Task: Implement Auto-Pairing in `packages/ai-gen`
  - [ ] Define and document the pairing policy:
    - [ ] Many-duels-per-poem model (HUMAN poem can face multiple AI poems in same topic).
    - [ ] Unordered pair uniqueness (`A/B` and `B/A` treated as the same pair), enforced via deterministic duel IDs (e.g., hash of sorted poem IDs).
    - [ ] Bounded fan-out per HUMAN poem to control scale.
  - [ ] Write failing tests for duel assembly behavior:
    - [ ] Creates multiple duels for one HUMAN poem when multiple eligible AI poems exist.
    - [ ] Prevents duplicate duel creation for an existing unordered pair.
    - [ ] Resolves `topic_id`/`topic` from the selected shared topic.
    - [ ] Uses a pseudo-random selection (e.g., seeded by poem IDs) when multiple shared topics exist to avoid alphabetical skew.
    - [ ] Skips pair creation when no shared topic exists.
    - [ ] Randomizes `poem_a` and `poem_b` on first pair creation.
    - [ ] Preserves existing orientation and skips insertions on reruns (idempotency).
  - [ ] Implement pair candidate selection and assembly logic in `packages/ai-gen`:
    - [ ] Extract pairing logic into a pure, testable function `assemblePairs` (Functional Core) separated from database side-effects.
    - [ ] Select eligible HUMAN↔AI pairings by shared topic.
    - [ ] Ensure deterministic selection order for capped fan-out.
    - [ ] Perform bulk database insertions using `INSERT ON CONFLICT DO NOTHING` for optimal performance.
  - [ ] Integrate duel assembly step into AI generation completion flow.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Duel Assembly Logic' (Protocol in workflow.md)

## Phase 3: API Updates

- [ ] Task: Promote `GET /duels/:id` as canonical duel retrieval endpoint
  - [ ] Write failing tests for anonymous duel retrieval by ID and `featured_duels` logging side effect.
  - [ ] Implement/adjust route behavior so multiple duels can be served on the same day without daily lock semantics.
  - [ ] Throw custom Error classes (e.g., `NotFoundError`) to trigger a standardized `404` payload `{ error: 'Duel not found', code: 'DUEL_NOT_FOUND' }` when duel exists but references a missing poem row.
  - [ ] Remove `GET /duels/today` from `apps/api/src/routes/duels.ts`.
  - [ ] Remove/update callers and tests that depend on `GET /duels/today`.
  - [ ] Ensure unknown/deprecated duel endpoints return HTTP `404` with `{ error: string, code: 'ENDPOINT_NOT_FOUND' }`.
- [ ] Task: Update `GET /duels` and `GET /duels/:id/stats`
  - [ ] Define response contracts in tests and docs:
    - [ ] `GET /duels` returns `topic` (legacy string) and `topicMeta` object.
    - [ ] `GET /duels/:id/stats` returns `duel.topicMeta` and per-poem `sourceInfo`.
  - [ ] Define standardized Phase 5 error contract in tests and docs:
    - [ ] Implement Hono global error handling middleware to catch custom Error classes and format standardized `{ error: string, code: string }` responses.
    - [ ] `INVALID_PAGE`, `DUEL_NOT_FOUND`, and `ENDPOINT_NOT_FOUND` are used consistently.
  - [ ] Write failing tests for `GET /duels`:
    - [ ] Invalid `page` query values return `400` (`0`, negative, non-integer, non-numeric).
    - [ ] `400` payload uses stable shape `{ error: string, code: 'INVALID_PAGE' }`.
    - [ ] Includes `topicMeta.id` + `topicMeta.label` when topic join succeeds.
    - [ ] Falls back to `topicMeta: { id: null, label: duel.topic }` when `topic_id` is missing/unresolved.
  - [ ] Write failing tests for `GET /duels/:id/stats`:
    - [ ] Returns `404` payload `{ error: 'Duel not found', code: 'DUEL_NOT_FOUND' }` when duel references missing poem row(s).
    - [ ] Includes topic metadata in `duel.topicMeta`.
    - [ ] Includes per-poem `sourceInfo.primary` and `sourceInfo.provenances`.
    - [ ] Allows AI poems to return empty `sourceInfo.provenances`.
    - [ ] Returns `sourceInfo.provenances` sorted by `scrapedAt` descending.
  - [ ] Update Drizzle queries in `apps/api/src/routes/duels.ts`:
    - [ ] Join `topics` for list and stats responses.
    - [ ] Fetch `scrape_sources` for both poem IDs in a single round trip (e.g., using `WHERE poem_id IN (...)` or Drizzle relational queries) to avoid N+1 queries.
    - [ ] Map fallback values for missing topic joins and missing scrape rows.
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
