# Implementation Plan: User Analytics & Global Statistics

## Alignment Notes (Current Codebase Reality)
- There is no separate "Verdict API" today; the existing "Verdict-like" payload is:
  - `GET /api/v1/duels/:id/stats` (`apps/api/src/routes/duels.ts`)
- The current "Avg. Read Time" is **not analytics**; it is computed from poem word-count (~200 wpm):
  - `computeAvgReadingTime(contentA, contentB)` (`apps/api/src/routes/duels.ts`)
- `POST /api/v1/votes` currently has no `db` injection (harder to test); other routers use `createXRouter(db)`:
  - `votesRouter` (`apps/api/src/routes/votes.ts`)
- The frontend "Reading Room" experience is implemented as `TheRing` + `VerdictPopup`:
  - Vote write: `apps/web/pages/TheRing.tsx#handleVote`
  - Verdict UI: `apps/web/components/VerdictPopup.tsx`

## Architecture Decisions (Confirmed)
- Topic aggregates are keyed by `duels.topicId` only. `duels.topicId` must be non-null and refer to a real `topics.id`.
- `readingTimeMs` is mandatory in the vote payload. No server-side fallback.
- Replace the word-count `avgReadingTime` estimate everywhere with behavioral `avgDecisionTime`.
- Backend returns both `avgDecisionTimeMs` and a formatted `avgDecisionTime` string.
- `readingTimeMs` values over 10 minutes are clamped to 10 minutes.

## Phase 1: Database & Data Model Updates
- [x] Task: Design aggregates schema in `@sanctuary/db/schema` [e90b39a]
  - [x] Add `votes.readingTimeMs` (integer, not null; milliseconds) to support behavioral timing samples.
  - [x] Add indexes needed for aggregation/update paths:
    - [x] `votes(duel_id)` (join/group updates)
    - [x] `duels(topic_id)` if topic aggregation is by `topicId`
  - [x] Enforce mandatory topics in the schema:
    - [x] Make `duels.topicId` non-nullable
    - [x] Ensure all existing rows are backfilled to a real `topics.id` before applying the constraint
  - [x] Create `global_statistics` table:
    - [x] Single-row table keyed by `id = 'global'`
    - [x] Columns (suggested): `totalVotes`, `humanVotes`, `decisionTimeSumMs`, `decisionTimeCount`, `updatedAt`
  - [x] Create `topic_statistics` table:
    - [x] Primary key keyed by `topicId` (and enforce referential integrity to `topics.id`)
    - [x] Columns mirror `global_statistics` plus `topicLabel` for display stability
  - [x] Generate Drizzle migrations (`pnpm --filter @sanctuary/api db:generate`)
  - [x] Ensure `apps/api/src/routes/*.test.ts` in-memory DDL is updated to include the new column(s) and new tables so tests remain representative.
- [x] Task: Backfill / initialization strategy [e90b39a]
  - [x] Decide whether to:
    - [x] Initialize aggregates at zero and let them build over time (chosen — old votes lack readingTimeMs so full backfill is not possible; aggregates build from new votes only)
- [x] Task: Conductor - User Manual Verification 'Phase 1: Database & Data Model Updates' (Protocol in workflow.md) (d6ac81e)
  - [x] Automation script: `scripts/verify-phase1-user-analytics.ts`.
  - Result: 47/47 checks passed (`phase1_user_analytics_2026-03-13T04_24_18_322Z`).

## Phase 2: Core Voting & Aggregation Logic
- [x] Task: Make votes router testable and extend payload [cb9dd04]
  - [x] Refactor `apps/api/src/routes/votes.ts` to `createVotesRouter(db)` (like `createDuelsRouter`), and wire it in `apps/api/src/index.ts`.
  - [x] Extend vote request schema to require `readingTimeMs` (integer ms).
  - [x] Add validation + outlier handling rules:
    - [x] `readingTimeMs <= 0`: reject request (400) and do not record the vote
    - [x] `readingTimeMs > 10 minutes`: clamp to 10 minutes before persisting and aggregating
- [x] Task: Implement atomic aggregate updates on vote write-path [cb9dd04]
  - [x] Update the vote insert to run in a DB transaction (db.batch()) that:
    - [x] inserts `votes` row
    - [x] upserts/increments `global_statistics`
    - [x] upserts/increments `topic_statistics` for the duel's topic
  - [x] Topic key is `duels.topicId` (mandatory, non-null)
- [x] Task: Tests (Red/Green) for voting + aggregates [cb9dd04]
  - [x] Create `apps/api/src/routes/votes.test.ts` using in-memory LibSQL (pattern in `duels.test.ts`)
  - [x] Test cases (17 tests across 3 describe blocks):
    - [x] valid vote increments `totalVotes` + `humanVotes` correctly (global + topic)
    - [x] `readingTimeMs` within range updates `decisionTimeSumMs` + `decisionTimeCount`
    - [x] outlier `readingTimeMs` is clamped to 10 minutes (affects aggregates, but bounded)
    - [x] invalid `readingTimeMs` (<= 0) rejects request and does not write vote or aggregates
- [~] Task: Conductor - User Manual Verification 'Phase 2: Core Voting & Aggregation Logic' (Protocol in workflow.md)

## Phase 3: Verdict API & Data Fetching
- [~] Task: Extend existing stats endpoint (Verdict payload)
  - [ ] Update `GET /api/v1/duels/:id/stats` to include:
    - [ ] `globalStats` (recognition rate + avg decision time)
    - [ ] `topicStats` for the duel's topic (recognition rate + avg decision time)
  - [ ] Keep existing fields additive to avoid breaking the frontend while iterating.
- [ ] Task: Align shared contracts and frontend API typings
  - [ ] Add shared types for aggregates in `packages/shared/src/index.ts` (or a dedicated file if the shared package is split later).
  - [ ] Reconcile the current mismatch where `packages/shared` exports `Duel` with `humanWinRate/avgReadingTime` while the API response shapes differ; update contracts to the new `avgDecisionTime` naming and the finalized Verdict payload shape.
  - [ ] Update `apps/web/lib/api.ts` response types to match the finalized backend payload (avoid unsafe `as Promise<T>` drift as much as possible).
- [ ] Task: Remove `avgReadingTime` estimate from API + contracts
  - [ ] Remove/rename fields returning word-count `avgReadingTime` from:
    - [ ] `GET /api/v1/duels`
    - [ ] `GET /api/v1/duels/:id/stats`
  - [ ] Replace with behavioral `avgDecisionTime` (and `avgDecisionTimeMs`) sourced from aggregates.
  - [ ] Define and implement semantics:
    - [ ] In `GET /api/v1/duels`, `avgDecisionTime*` is topic-level average decision time (from `topic_statistics`) for each row's topic.
    - [ ] In `GET /api/v1/duels/:id/stats`, Verdict UI should use `topicStats.avgDecisionTime*` and `globalStats.avgDecisionTime*`.
  - [ ] Update `packages/shared` and any docs/tests that reference `avgReadingTime`.
- [ ] Task: Tests (Red/Green) for Verdict payload shape
  - [ ] Extend `apps/api/src/routes/duels.test.ts` to assert the new fields exist and are correct.
  - [ ] Add edge-case tests:
    - [ ] no aggregates row yet (endpoint still returns 200 with zeros/nulls)
    - [ ] topic present and consistent (topicId is mandatory)
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Verdict API & Data Fetching' (Protocol in workflow.md)

## Phase 4: Frontend Tracking & Verdict UI
- [ ] Task: Implement client-side decision-time tracking in The Ring
  - [ ] Record a start timestamp when the duel becomes visible/interactive (recommend: set when `duel.id` changes and UI is ready).
  - [ ] On vote submit, compute `readingTimeMs = now - start` and send it via `api.vote(...)`.
  - [ ] Ensure swipe/transition logic resets the timer per duel.
- [ ] Task: Update Verdict UI to use aggregates
  - [ ] Add UI for global recognition rate (Human vs AI bar)
  - [ ] Add UI for topic recognition rate + delta vs global
  - [ ] Display average decision time (global + topic) with clear label
  - [ ] Replace any UI references to `avgReadingTime` with behavioral `avgDecisionTime` sourced from aggregates.
- [ ] Task: Frontend testing updates
  - [ ] Update any unit/integration tests that assert the Verdict layout.
  - [ ] (Optional) Add an e2e test in `packages/e2e` to cover "vote -> verdict shows stats".
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Frontend Tracking & Verdict UI' (Protocol in workflow.md)

## Phase 5: Regression & Quality Gate
- [ ] Task: Coverage and Regression Verification
    - [ ] Execute the project's test suite and resolve failures related to this track only.
    - [ ] Execute `pnpm run lint`.
    - [ ] Execute `pnpm format:check` (or `pnpm format` to fix).
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify votes correctly update the new global and topic stats in DB
  - [ ] Verify `readingTimeMs` is captured for each vote and values over 10 minutes are clamped
  - [ ] Verify Verdict UI displays win rate bars correctly with real data
  - [ ] Verify Verdict UI displays topic breakdown correctly
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 6: Documentation
- [ ] Task: Documentation Update
  - [ ] Document new vote payload structure (`readingTimeMs`) and validation rules.
  - [ ] Document the aggregates tables, update strategy, and topic-keying rules.
  - [ ] Document removal of word-count `avgReadingTime` and replacement with `avgDecisionTime`.
  - [ ] Update relevant files in `docs/` and READMEs.
