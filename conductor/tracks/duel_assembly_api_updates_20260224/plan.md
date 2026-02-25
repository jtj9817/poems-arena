# Implementation Plan - Phase 5: Duel Assembly & API Updates

## Phase 1: Database Schema Updates

- [ ] Task: Add `featured_duels` table
  - [ ] Write a test for the new table schema (if applicable in the test suite).
  - [ ] Add the `featured_duels` table definition to the Drizzle schema in the shared database package.
  - [ ] Generate and apply the database migrations.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Database Schema Updates' (Protocol in workflow.md)

## Phase 2: Duel Assembly Logic

- [ ] Task: Implement Auto-Pairing in `packages/ai-gen`
  - [ ] Write a failing test for the duel creation logic, ensuring randomization of `poem_a` and `poem_b` and correct topic inheritance.
  - [ ] Implement the duel assembly step at the end of the AI generation pipeline, creating a new duel for every newly generated AI poem.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Duel Assembly Logic' (Protocol in workflow.md)

## Phase 3: API Updates

- [ ] Task: Update `GET /duels` and `GET /duels/:id/stats`
  - [ ] Write failing tests for fetching duels with topic metadata and stats with topic/source info.
  - [ ] Update Drizzle queries in `apps/api/src/routes/duels.ts` to join `topics` and `scrape_sources` tables.
- [ ] Task: Update `GET /duels/today`
  - [ ] Write failing tests for selecting a daily duel based on "largest pool first" topic rotation and recording it in `featured_duels`.
  - [ ] Implement the daily selection logic prioritizing topics with the most unused duels, and handle the insertion into the `featured_duels` tracking table.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: API Updates' (Protocol in workflow.md)

## Phase 4: Regression & Quality Gate

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute tests across affected packages (`@sanctuary/ai-gen`, `@sanctuary/api`) to ensure >80% coverage.
  - [ ] Execute `pnpm lint` and `pnpm format:check`.
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify that running the AI generator also successfully creates new duels in the database.
  - [ ] Verify that `GET /duels/today` rotates correctly and populates `featured_duels`.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

- [ ] Task: Documentation Update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 5 completion.
  - [ ] Document the new `featured_duels` table and updated API endpoints.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Documentation' (Protocol in workflow.md)
