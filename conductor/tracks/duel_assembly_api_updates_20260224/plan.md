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
  - [ ] Write a failing test for the duel creation logic, ensuring randomization of `poem_a` and `poem_b` and correct topic inheritance.
  - [ ] Implement the duel assembly step at the end of the AI generation pipeline, creating a new duel for every newly generated AI poem.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Duel Assembly Logic' (Protocol in workflow.md)

## Phase 3: API Updates

- [ ] Task: Promote `GET /duels/:id` as canonical duel retrieval endpoint
  - [ ] Write failing tests for anonymous duel retrieval by ID and `featured_duels` logging side effect.
  - [ ] Implement/adjust route behavior so multiple duels can be served on the same day without daily lock semantics.
  - [ ] Decide and implement compatibility behavior for `GET /duels/today` (deprecate/remove/temporary alias).
- [ ] Task: Update `GET /duels` and `GET /duels/:id/stats`
  - [ ] Write failing tests for fetching duels with topic metadata and stats with topic/source info for both poems.
  - [ ] Update Drizzle queries in `apps/api/src/routes/duels.ts` to join `topics` and `scrape_sources` tables.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: API Updates' (Protocol in workflow.md)

## Phase 4: Regression & Quality Gate

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute tests across affected packages (`@sanctuary/ai-gen`, `@sanctuary/api`) to ensure >80% coverage.
  - [ ] Execute `pnpm lint` and `pnpm format:check`.
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify that running the AI generator also successfully creates new duels in the database.
  - [ ] Verify repeated calls to `GET /duels/:id` append records to `featured_duels` (including same-day duplicates).
  - [ ] Verify `GET /duels` + `GET /duels/:id` support serving multiple duels per day.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

- [ ] Task: Documentation Update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 5 completion.
  - [ ] Document the new `featured_duels` schema contract and append-only global tracking behavior.
  - [ ] Document `GET /duels/:id` as the canonical duel retrieval endpoint and the compatibility decision for `GET /duels/today`.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Documentation' (Protocol in workflow.md)
