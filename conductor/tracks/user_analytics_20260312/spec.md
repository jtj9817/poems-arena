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
