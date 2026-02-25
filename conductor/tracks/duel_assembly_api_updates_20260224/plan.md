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
    - [ ] Unordered pair uniqueness (`A/B` and `B/A` treated as the same pair).
    - [ ] Bounded fan-out per HUMAN poem to control scale.
  - [ ] Write failing tests for duel assembly behavior:
    - [ ] Creates multiple duels for one HUMAN poem when multiple eligible AI poems exist.
    - [ ] Prevents duplicate duel creation for an existing unordered pair.
    - [ ] Resolves `topic_id`/`topic` from the selected shared topic.
    - [ ] Randomizes `poem_a` and `poem_b` on first pair creation.
    - [ ] Preserves existing orientation and skips insertions on reruns (idempotency).
  - [ ] Implement pair candidate selection and assembly logic in `packages/ai-gen`:
    - [ ] Select eligible HUMAN↔AI pairings by shared topic.
    - [ ] Ensure deterministic selection order for capped fan-out.
    - [ ] Insert only missing unique pairs.
  - [ ] Integrate duel assembly step into AI generation completion flow.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Duel Assembly Logic' (Protocol in workflow.md)

## Phase 3: API Updates

- [ ] Task: Promote `GET /duels/:id` as canonical duel retrieval endpoint
  - [ ] Write failing tests for anonymous duel retrieval by ID and `featured_duels` logging side effect.
  - [ ] Implement/adjust route behavior so multiple duels can be served on the same day without daily lock semantics.
  - [ ] Remove `GET /duels/today` from `apps/api/src/routes/duels.ts`.
  - [ ] Remove/update callers and tests that depend on `GET /duels/today`.
- [ ] Task: Update `GET /duels` and `GET /duels/:id/stats`
  - [ ] Define response contracts in tests and docs:
    - [ ] `GET /duels` returns `topic` (legacy string) and `topicMeta` object.
    - [ ] `GET /duels/:id/stats` returns `duel.topicMeta` and per-poem `sourceInfo`.
  - [ ] Write failing tests for `GET /duels`:
    - [ ] Includes `topicMeta.id` + `topicMeta.label` when topic join succeeds.
    - [ ] Falls back to `topicMeta: { id: null, label: duel.topic }` when `topic_id` is missing/unresolved.
  - [ ] Write failing tests for `GET /duels/:id/stats`:
    - [ ] Includes topic metadata in `duel.topicMeta`.
    - [ ] Includes per-poem `sourceInfo.primary` and `sourceInfo.provenances`.
    - [ ] Allows AI poems to return empty `sourceInfo.provenances`.
    - [ ] Returns `sourceInfo.provenances` sorted by `scrapedAt` descending.
  - [ ] Update Drizzle queries in `apps/api/src/routes/duels.ts`:
    - [ ] Join `topics` for list and stats responses.
    - [ ] Query `scrape_sources` for both poem IDs in stats response.
    - [ ] Map fallback values for missing topic joins and missing scrape rows.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: API Updates' (Protocol in workflow.md)

## Phase 4: Regression & Quality Gate

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute tests across affected packages (`@sanctuary/ai-gen`, `@sanctuary/api`) to ensure >80% coverage.
  - [ ] Execute `pnpm lint` and `pnpm format:check`.
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify that running the AI generator also successfully creates new duels in the database.
  - [ ] Verify repeated calls to `GET /duels/:id` append records to `featured_duels` (including same-day duplicates).
  - [ ] Verify `GET /duels` + `GET /duels/:id` support serving multiple duels per day.
  - [ ] Verify API response edge cases:
    - [ ] Missing `topic_id` still yields stable `topicMeta` fallback.
    - [ ] AI poems return empty provenance arrays without failing stats payload.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

- [ ] Task: Documentation Update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 5 completion.
  - [ ] Document the new `featured_duels` schema contract and append-only global tracking behavior.
  - [ ] Document `GET /duels/:id` as the canonical duel retrieval endpoint and `GET /duels/today` deprecation/removal.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Documentation' (Protocol in workflow.md)
