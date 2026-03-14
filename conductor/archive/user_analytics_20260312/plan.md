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

## Precision Assertion Contract
- Behavior-level regression work must satisfy assertion IDs defined in:
  - `conductor/tracks/user_analytics_20260312/spec.md`
  - Section: `Behavior-Level Interaction Assertions (Normative Test Contract)`
- During Phase 5, every assertion ID must be mapped to:
  - automated test coverage, or
  - explicit manual verification evidence (if automation is not feasible)
- Any uncovered assertion ID blocks completion of Phase 5.

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
- [x] Task: Conductor - User Manual Verification 'Phase 2: Core Voting & Aggregation Logic' (Protocol in workflow.md) (d605735)
  - [x] Automation script: `scripts/verify-phase2-user-analytics.ts`.
  - [x] Result: 41/41 checks passed (`phase2_user_analytics_2026-03-13T04_59_53_285Z`).

## Phase 3: Verdict API & Data Fetching
- [x] Task: Extend existing stats endpoint (Verdict payload) [782374e]
  - [x] Update `GET /api/v1/duels/:id/stats` to include:
    - [x] `globalStats` (recognition rate + avg decision time)
    - [x] `topicStats` for the duel's topic (recognition rate + avg decision time)
  - [x] Keep existing fields additive to avoid breaking the frontend while iterating.
- [x] Task: Align shared contracts and frontend API typings [782374e]
  - [x] Add shared types for aggregates in `packages/shared/src/index.ts` (or a dedicated file if the shared package is split later).
  - [x] Reconcile the current mismatch where `packages/shared` exports `Duel` with `humanWinRate/avgReadingTime` while the API response shapes differ; update contracts to the new `avgDecisionTime` naming and the finalized Verdict payload shape.
  - [x] Update `apps/web/lib/api.ts` response types to match the finalized backend payload (avoid unsafe `as Promise<T>` drift as much as possible).
- [x] Task: Remove `avgReadingTime` estimate from API + contracts [782374e]
  - [x] Remove/rename fields returning word-count `avgReadingTime` from:
    - [x] `GET /api/v1/duels`
    - [x] `GET /api/v1/duels/:id/stats`
  - [x] Replace with behavioral `avgDecisionTime` (and `avgDecisionTimeMs`) sourced from aggregates.
  - [x] Define and implement semantics:
    - [x] In `GET /api/v1/duels`, `avgDecisionTime*` is topic-level average decision time (from `topic_statistics`) for each row's topic.
    - [x] In `GET /api/v1/duels/:id/stats`, Verdict UI should use `topicStats.avgDecisionTime*` and `globalStats.avgDecisionTime*`.
  - [x] Update `packages/shared` and any docs/tests that reference `avgReadingTime`.
- [x] Task: Tests (Red/Green) for Verdict payload shape [782374e]
  - [x] Extend `apps/api/src/routes/duels.test.ts` to assert the new fields exist and are correct.
  - [x] Add edge-case tests:
    - [x] no aggregates row yet (endpoint still returns 200 with zeros/nulls)
    - [x] topic present and consistent (topicId is mandatory)
- [x] Task: Conductor - User Manual Verification 'Phase 3: Verdict API & Data Fetching' (Protocol in workflow.md) [782374e]
  - [x] Automation script: `scripts/verify-phase3-user-analytics.ts`.
  - [x] Result: all checks passed (`phase3_user_analytics_2026-03-13T05_51_57_715Z`).

## Phase 4: Frontend Tracking & Verdict UI
- [x] Task: Implement client-side decision-time tracking in The Ring [54d0763]
  - [x] Record a start timestamp when the duel becomes visible/interactive (recommend: set when `duel.id` changes and UI is ready).
  - [x] On vote submit, compute `readingTimeMs = now - start` and send it via `api.vote(...)`.
  - [x] Ensure swipe/transition logic resets the timer per duel.
- [x] Task: Update Verdict UI to use aggregates [54d0763]
  - [x] Add UI for global recognition rate (Human vs AI bar)
  - [x] Add UI for topic recognition rate + delta vs global
  - [x] Display average decision time (global + topic) with clear label
  - [x] Replace any UI references to `avgReadingTime` with behavioral `avgDecisionTime` sourced from aggregates.
- [x] Task: Frontend testing updates [54d0763]
  - [x] Update any unit/integration tests that assert the Verdict layout.
  - [x] (Optional) Add an e2e test in `packages/e2e` to cover "vote -> verdict shows stats".
- [x] Task: Conductor - User Manual Verification 'Phase 4: Frontend Tracking & Verdict UI' (Protocol in workflow.md)
  - [x] Automation script: `scripts/verify-phase4-user-analytics.ts`.
  - [x] Result: 23/23 checks passed (`phase4_user_analytics_2026-03-13T20_19_48_779Z`).

## Phase 5: Regression & Quality Gate
- [x] Task: Coverage and Regression Verification [f031041]
  - [x] Execute API regression suite: `pnpm --filter @sanctuary/api test src/routes/votes.test.ts src/routes/duels.test.ts`.
  - [x] Execute web regression suite: `pnpm --filter @sanctuary/web test`.
  - [x] Execute workspace lint: `pnpm run lint`.
  - [x] Execute formatting gate: `pnpm format:check` (or `pnpm format` then re-run check).
  - [x] Record commands and pass/fail output in the phase verification artifact.
- [x] Task: Regression Checklist (Feature Behaviors) [3229775]
  - [x] API assertions completed:
    - [x] `UA-API-001`, `UA-API-002`, `UA-API-003` (vote payload validation)
    - [x] `UA-API-004`, `UA-API-005`, `UA-API-006`, `UA-API-007`, `UA-API-008` (write-path + aggregates)
    - [x] `UA-API-009`, `UA-API-010`, `UA-API-011`, `UA-API-012` (stats payload + formatting + field removal)
  - [x] Frontend assertions completed:
    - [x] `UA-FE-001`, `UA-FE-002`, `UA-FE-003`, `UA-FE-004`, `UA-FE-005` (interaction + network behavior)
    - [x] `UA-FE-006`, `UA-FE-007`, `UA-FE-008`, `UA-FE-009`, `UA-FE-010`, `UA-FE-011` (Verdict rendering + fallbacks)
  - [x] Cross-layer assertions completed:
    - [x] `UA-FLOW-001`, `UA-FLOW-002`, `UA-FLOW-003`, `UA-FLOW-004`
  - [x] For each assertion ID above, link the concrete test file and test name (or manual evidence path).
  - [x] Confirm no remaining references to `avgReadingTime` in API responses, shared contracts, or Verdict UI code paths.
- [x] Task: Interaction Assertion Coverage Map [3229775]
  - [x] Create/update a short mapping table in the verification artifact:
    - [x] columns: `Assertion ID`, `Coverage Type (Automated|Manual)`, `Test/Artifact`, `Status`
  - [x] If any assertion remains manual-only, document why automation is not practical and list mitigation.
  - [x] If any assertion fails, file a follow-up task before phase completion.
- [x] Task: Conductor - User Manual Verification 'Phase 5: Regression & Quality Gate' (Protocol in workflow.md)
  - [x] Automation script: `scripts/verify-phase5-user-analytics.ts`.
  - [x] Result: 104/104 checks passed (`phase5_user_analytics_2026-03-14T03_27_43_349Z`).

## Phase 6: Documentation [checkpoint: fe9ccff]
- [x] Task: Documentation Update [50897e5]
  - [x] Document new vote payload structure (`readingTimeMs`) and validation rules.
  - [x] Document the aggregates tables, update strategy, and topic-keying rules.
  - [x] Document removal of word-count `avgReadingTime` and replacement with `avgDecisionTime`.
  - [x] Update relevant files in `docs/` and READMEs.
