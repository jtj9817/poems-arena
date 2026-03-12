# Implementation Plan: User Analytics & Global Statistics

## Phase 1: Database & Data Model Updates
- [ ] Task: Design and create migrations for aggregated statistics tables
    - [ ] Create Drizzle schema for `global_statistics` (overall win rates, avg time)
    - [ ] Create Drizzle schema for `topic_statistics` (win rates per topic)
    - [ ] Generate Drizzle migrations (`pnpm --filter @sanctuary/api db:generate`)
- [ ] Task: Implement repository functions for statistics
    - [ ] Write failing unit tests for statistics repository (read/update operations)
    - [ ] Implement statistics repository in backend (using Drizzle)
    - [ ] Run tests and ensure they pass (Green Phase)
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Database & Data Model Updates' (Protocol in workflow.md)

## Phase 2: Core Voting & Aggregation Logic
- [ ] Task: Update voting endpoint to record reading time and calculate aggregates
    - [ ] Write failing unit tests for voting endpoint (testing outlier rejection, server fallback, and aggregate updates)
    - [ ] Implement client-side reading time parsing from request payload
    - [ ] Implement outlier rejection logic (> 10 mins) and server-side fallback
    - [ ] Update vote transaction to asynchronously or synchronously update global/topic stats
    - [ ] Run tests and ensure they pass (Green Phase)
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Core Voting & Aggregation Logic' (Protocol in workflow.md)

## Phase 3: Verdict API & Data Fetching
- [ ] Task: Implement or update Verdict API endpoint
    - [ ] Write failing unit tests for Verdict API response (must include global and topic stats)
    - [ ] Implement endpoint to fetch aggregated stats alongside duel results
    - [ ] Run tests and ensure they pass (Green Phase)
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Verdict API & Data Fetching' (Protocol in workflow.md)

## Phase 4: Frontend Tracking & Verdict UI
- [ ] Task: Implement client-side reading time tracking
    - [ ] Add start time tracking when Reading Room mounts
    - [ ] Calculate duration on vote submission and include in API payload
- [ ] Task: Build Verdict UI Components
    - [ ] Create UI components for "Win Rate Bars" (Human vs AI)
    - [ ] Create UI components for "Topic Breakdown" comparing current topic to global average
    - [ ] Integrate real statistics data into the Verdict screen, removing hardcoded placeholders
    - [ ] Update frontend unit/integration tests
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Frontend Tracking & Verdict UI' (Protocol in workflow.md)

## Phase 5: Regression & Quality Gate
- [ ] Task: Coverage and Regression Verification
    - [ ] Execute the project's test suite and resolve failures related to this track only.
    - [ ] Execute `pnpm run lint`.
    - [ ] Execute `pnpm format:check` (or `pnpm format` to fix).
- [ ] Task: Regression Checklist (Feature Behaviors)
    - [ ] Verify votes correctly update the new global and topic stats in DB
    - [ ] Verify reading time is accurately captured and outlier times are rejected
    - [ ] Verify Verdict UI displays win rate bars correctly with real data
    - [ ] Verify Verdict UI displays topic breakdown correctly
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 6: Documentation
- [ ] Task: Documentation Update
    - [ ] Document new API payload structure for voting (reading time)
    - [ ] Document the aggregated statistics tables and update architecture docs
    - [ ] Document the outlier rejection parameters
    - [ ] Update relevant files in `docs/` and READMEs.
