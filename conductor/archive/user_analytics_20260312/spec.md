# Specification: User Analytics & Global Statistics (The Verdict)

## Overview
This track implements real-time, first-party aggregate statistics to be displayed on the "Verdict" UI shown after a user votes in The Ring (aka "Reading Room" in copy/comments).

The goal is to replace the current "Avg. Read Time" *estimate* (computed from poem word-count) with *behavioral analytics* derived from anonymous votes:

- **Recognition rate**: How often users correctly pick the HUMAN poem (global + per topic).
- **Decision time**: How long users take between seeing a duel and voting (global + per topic).

## Current State (as of 2026-03-12)
- Backend:
  - `POST /api/v1/votes` accepts `{ duelId, selectedPoemId }`, inserts a row into `votes`, returns `{ success, isHuman }`. (`apps/api/src/routes/votes.ts`)
  - `GET /api/v1/duels/:id/stats` returns a duel reveal payload and **per-duel** `humanWinRate`, plus an **estimated** `avgReadingTime` derived from word-count at ~200 wpm. (`apps/api/src/routes/duels.ts#computeAvgReadingTime`)
- Frontend:
  - The Ring flow posts the vote, then fetches `/duels/:id/stats`, and renders `VerdictPopup`. (`apps/web/pages/TheRing.tsx`, `apps/web/components/VerdictPopup.tsx`)
- Data model:
  - `duels.topicId` is currently nullable in the schema, even though product intends topics to be mandatory. (`@sanctuary/db/schema`)

## Functional Requirements
1. **Aggregated Data Storage (First-Party):**
   - Add aggregate storage to LibSQL/Drizzle for:
     - Global recognition rate and average decision time
     - Per-topic recognition rate and average decision time
   - Aggregates must be updated as part of the vote write-path (single transaction) to keep reads fast and deterministic.
2. **Decision Time Measurement (Client-Supplied):**
   - Track decision time in the frontend as the duration between:
     - "duel becomes visible/interactive" and "vote submitted"
   - Include the measured duration in the vote payload as `readingTimeMs` (duration in milliseconds).
   - `readingTimeMs` is **mandatory** in the vote payload.
   - Backend validates and clamps timing values:
     - `readingTimeMs <= 0`: reject request (400) and do not record the vote.
     - `readingTimeMs > 10 * 60 * 1000` (10 minutes): clamp to 10 minutes before persisting and aggregating.
3. **Verdict UI:**
   - Update `VerdictPopup` to show:
     - Global recognition rate (Human vs AI bar)
     - Topic recognition rate (Human vs AI bar) for the duel's topic
     - Global average decision time (formatted)
     - Topic average decision time (formatted)
     - A comparison indicator: "This topic is +X% / -X% vs global"

## Non-Functional Requirements
- **Performance:** Verdict reads must be constant-time queries (no scanning/grouping the entire `votes` table on each vote). Aggregates should be updated in the same transaction as the vote insert.
- **Accuracy:** Outlier rejection must prevent obvious skew (stale tabs, backgrounded sessions) while keeping legitimate reads. Defaults above are conservative and can be tuned later.
- **Determinism:** A vote should update aggregates exactly once (the system currently allows duplicate votes; aggregates must match the `votes` table semantics).

## Acceptance Criteria
- [ ] Voting updates the aggregated statistics correctly in the database.
- [ ] Decision time is captured from the client and is required in the vote payload; out-of-range values are clamped to 10 minutes.
- [ ] `GET /api/v1/duels/:id/stats` (or a dedicated Verdict endpoint) includes global + topic aggregates needed by the UI.
- [ ] The Verdict UI displays global and topic recognition rate bars and the global/topic average decision time.
- [ ] The old word-count "avgReadingTime" estimate is fully removed and replaced by "avgDecisionTime".

## Behavior-Level Interaction Assertions (Normative Test Contract)
These assertions define the minimum behavior-level contract for robust testing in
Phase 5. A Phase 5 implementation is not complete until all assertion IDs below
are covered by automated tests or an explicitly documented manual check.

### Canonical Fixture Values (for deterministic assertions)
Use these values in test setup to avoid ambiguous expectations:

- `MAX_READING_TIME_MS = 600000` (10 minutes)
- `topic = Nature`, `topicId = topic-nature`
- Seeded global aggregate row example:
  - `totalVotes = 12`
  - `humanVotes = 9`
  - `decisionTimeSumMs = 1440000`
  - `decisionTimeCount = 12`
  - expected: `humanWinRate = 75`, `avgDecisionTimeMs = 120000`, `avgDecisionTime = "2m 00s"`
- Seeded topic aggregate row example:
  - `totalVotes = 8`
  - `humanVotes = 6`
  - `decisionTimeSumMs = 480000`
  - `decisionTimeCount = 8`
  - expected: `humanWinRate = 75`, `avgDecisionTimeMs = 60000`, `avgDecisionTime = "1m 00s"`

### API Interaction Assertions
- [ ] `UA-API-001` Vote payload validation rejects missing `readingTimeMs` with HTTP `400`.
- [ ] `UA-API-002` Vote payload validation rejects `readingTimeMs <= 0` with HTTP `400`.
- [ ] `UA-API-003` Vote payload validation rejects non-integer `readingTimeMs` with HTTP `400`.
- [ ] `UA-API-004` Vote payload clamps `readingTimeMs > 600000` to `600000` in persisted `votes.readingTimeMs`.
- [ ] `UA-API-005` Invalid vote requests do not insert into `votes` and do not mutate `global_statistics`/`topic_statistics`.
- [ ] `UA-API-006` Valid vote inserts exactly one `votes` row and increments `global_statistics.totalVotes` by exactly `1`.
- [ ] `UA-API-007` Human vote increments `humanVotes`; AI vote does not increment `humanVotes`.
- [ ] `UA-API-008` Valid vote increments `decisionTimeSumMs` by persisted (post-clamp) `readingTimeMs` and increments `decisionTimeCount` by `1` for both global and topic rows.
- [ ] `UA-API-009` `GET /api/v1/duels/:id/stats` returns `globalStats` and `topicStats` even when aggregates are missing, with `totalVotes = 0`, `humanWinRate = 0`, and `avgDecisionTime* = null`.
- [ ] `UA-API-010` `GET /api/v1/duels/:id/stats` returns correctly formatted `avgDecisionTime` strings (`"0m 08s"`, `"2m 00s"`, `"4m 12s"`).
- [ ] `UA-API-011` `GET /api/v1/duels/:id/stats` preserves topic identity in `topicStats.topicMeta` (`id` and `label`) from duel topic context.
- [ ] `UA-API-012` API responses in this track contain no `avgReadingTime` field.

### Frontend Interaction Assertions
- [ ] `UA-FE-001` Decision timer starts when a duel becomes interactable (post initial load transition).
- [ ] `UA-FE-002` Decision timer resets when swipe-in completes for the next duel.
- [ ] `UA-FE-003` On vote submit, frontend sends `api.vote({ duelId, selectedPoemId, readingTimeMs })` with positive integer `readingTimeMs`.
- [ ] `UA-FE-004` During non-interactive states (popup open / swipe transition / fade-in not complete), vote actions are blocked (no duplicate `api.vote` call).
- [ ] `UA-FE-005` After vote success, frontend requests `GET /duels/:id/stats` exactly once for the voted duel.
- [ ] `UA-FE-006` Verdict dialog renders global recognition section including percentage label and width-based bar from `globalStats.humanWinRate`.
- [ ] `UA-FE-007` Verdict dialog renders topic recognition section including percentage label and width-based bar from `topicStats.humanWinRate`.
- [ ] `UA-FE-008` Verdict dialog renders topic-vs-global delta indicator using direction (`↑`/`↓`) and absolute percentage.
- [ ] `UA-FE-009` Verdict dialog renders global/topic average decision time from `avgDecisionTime`; falls back to `—` when `avgDecisionTime` is `null`.
- [ ] `UA-FE-010` Verdict UI and API client types contain no `avgReadingTime` references.
- [ ] `UA-FE-011` If stats fetch fails after vote submission, verdict popup still opens and the user can continue/review.

### Cross-Layer Flow Assertions
- [ ] `UA-FLOW-001` Full flow "duel visible -> vote -> stats fetch -> verdict render" uses aggregate-backed fields end-to-end without schema/type mismatch.
- [ ] `UA-FLOW-002` Two sequential votes across two duels produce independent `readingTimeMs` values (timer reset between duels) and both payloads satisfy API constraints.
- [ ] `UA-FLOW-003` Topic delta shown in Verdict equals `topicStats.humanWinRate - globalStats.humanWinRate`.
- [ ] `UA-FLOW-004` Archive endpoint (`GET /duels`) exposes `avgDecisionTimeMs`/`avgDecisionTime` and does not expose `avgReadingTime`.

## Out of Scope
- Detailed per-user historical tracking (focus is on global aggregates).
- Time-series graphing of stats over time (e.g., win rates by day/month).
- Fraud prevention / bot filtering (votes are anonymous today).

## Proposed API Shape (Concrete)
This is the minimal, repo-aligned evolution of the existing "stats" endpoint.

- `GET /api/v1/duels`
  - Response JSON (per row changes):
    - Remove: `avgReadingTime` (word-count estimate)
    - Add: `avgDecisionTimeMs: number | null` and `avgDecisionTime: string | null`
  - Semantics:
    - `avgDecisionTime*` is the *topic-level* average decision time for that duel's topic (from `topic_statistics`).
    - If there is no timing sample yet for that topic, `avgDecisionTime*` is `null`.

- `POST /api/v1/votes`
  - Request JSON:
    - `duelId: string`
    - `selectedPoemId: string`
    - `readingTimeMs: number` (required; integer ms; validated)
  - Validation:
    - `readingTimeMs <= 0`: 400
    - `readingTimeMs > 10 minutes`: clamp to 10 minutes
  - Response JSON (unchanged):
    - `success: true`
    - `isHuman: boolean`

- `GET /api/v1/duels/:id/stats`
  - Additive response fields (new):
    - `globalStats: { totalVotes: number; humanWinRate: number; avgDecisionTimeMs: number | null; avgDecisionTime: string | null }`
    - `topicStats: { topicMeta: { id: string; label: string }; totalVotes: number; humanWinRate: number; avgDecisionTimeMs: number | null; avgDecisionTime: string | null }`
  - Notes:
    - `avgDecisionTimeMs` is `null` when there is no usable timing sample yet.
    - `avgReadingTime` (word-count estimate) is removed.
    - Time formatting matches `"4m 12s"` and includes sub-minute values like `"0m 08s"` (seconds are two digits).

## Resolved Decisions (From User)
1. Topic aggregates are keyed by `duels.topicId` only, and `topicId` must be mandatory.
2. `readingTimeMs` is mandatory and tracked client-side; no server-side fallback.
3. Replace `avgReadingTime` everywhere (remove word-count estimate).
4. Backend returns both `avgDecisionTimeMs` and a formatted `avgDecisionTime` string.
5. `readingTimeMs` values over 10 minutes are clamped to 10 minutes.
