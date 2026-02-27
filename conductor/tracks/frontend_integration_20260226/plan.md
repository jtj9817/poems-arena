# Implementation Plan: Phase 6 - Frontend Integration

## Phase 0: Backend Prerequisites [checkpoint: 7fe24fe]

**Goal:** Add missing API endpoints and filtering required by the frontend.

- [x] Task: Create `GET /api/v1/topics` Route — f2979ba
  - [x] Create `apps/api/src/routes/topics.ts` returning all canonical topics from the `topics` table.
  - [x] Mount the topics router in `apps/api/src/index.ts`.
- [x] Task: Add `topic_id` Filter to `GET /api/v1/duels` — 7e7a939
  - [x] Accept optional `topic_id` query parameter in `apps/api/src/routes/duels.ts`.
  - [x] Apply `.where(eq(duels.topicId, topicId))` when the parameter is present.
  - [x] Add test coverage for the new filter in `duels.test.ts`.
- [x] Task: Add Shared Types for `TopicMeta` and `SourceInfo` — b78f6e2
  - [x] Add `TopicMeta` interface (`{ id: string | null; label: string }`) to `packages/shared/src/index.ts`.
  - [x] Add `SourceInfo` interface (matching the API's `buildSourceInfo` shape) to `packages/shared/src/index.ts`.
  - [x] Extend the shared `Poem` type with an optional `sourceInfo?: SourceInfo` field.
- [x] Task: Conductor - User Manual Verification 'Phase 0: Backend Prerequisites' (Protocol in workflow.md) — 7fe24fe

## Phase 1: Topic Filtering Infrastructure [checkpoint: 1e44ac6]

**Goal:** Implement the data fetching and state management for canonical topics on the Anthology page.

- [x] Task: Update `apps/web/lib/api.ts` for Topic Support — 39eff5a
  - [x] Add `getTopics()` to fetch `GET /api/v1/topics`.
  - [x] Update `getDuels(page, topicId?)` to support optional `topic_id` query parameter.
  - [x] Update `DuelListItem` to include `topicMeta: TopicMeta` (matching the API response shape).
- [x] Task: Implement `TopicBar` Component — 39eff5a
  - [x] Create `apps/web/components/TopicBar.tsx`.
  - [x] Implement sticky horizontal scroll for topic chips.
  - [x] Support active/inactive states for single-select.
- [x] Task: Implement `BottomSheetFilter` for Mobile — 39eff5a
  - [x] Create `apps/web/components/BottomSheetFilter.tsx` (using vanilla CSS transitions).
  - [x] Integrate with `TopicBar` for mobile-specific rendering.
- [x] Task: Integrate Filtering into `Anthology.tsx` — 39eff5a
  - [x] Remove hardcoded `categories` array and replace with dynamic topics from `getTopics()`.
  - [x] Fetch topics on mount.
  - [x] Update duel list when a topic is selected (using `getDuels(page, topicId)`).
  - [x] Display `topicMeta.label` on `DuelCard` components instead of the raw `topic` string.
- [x] Task: Conductor - User Manual Verification 'Phase 1: Topic Filtering Infrastructure' (Protocol in workflow.md) — 1e44ac6

## Phase 2: Verdict Pop-Up & Swipe Transitions [checkpoint: 198c278]

**Goal:** Implement the Verdict as a pop-up overlay and add "swipe-like" transitions for continuous duel flow.

- [x] Task: Refactor Verdict into Pop-Up Component — 3891b28
  - [x] Extract the existing Verdict overlay from `ReadingRoom.tsx` into a dedicated `apps/web/components/VerdictPopup.tsx`.
  - [x] Display Verdict as a centered pop-up modal after vote submission.
  - [x] Include an "Acknowledge" action (e.g., "Continue" button) that dismisses the pop-up.
- [x] Task: Implement `SwipeContainer` Component — 3891b28
  - [x] Create `apps/web/components/SwipeContainer.tsx` using CSS Keyframes for swipe animations.
  - [x] Trigger the swipe-out transition for the current duel **after** the user acknowledges the Verdict pop-up.
  - [x] Trigger a swipe-in transition for the next duel.
- [x] Task: Implement Sliding Window Pre-Fetching — 3891b28
  - [x] On first duel entry, fetch the ordered duel ID list via `getDuels()` and store as a queue in client state.
  - [x] Pre-fetch the next 1–2 full duels (`getDuel(id)`) while the user reads the current duel.
  - [x] On "Next Duel" acknowledgment, advance the queue and pre-fetch the next duel.
  - [x] When approaching the end of the current page of IDs, fetch `getDuels(nextPage)` for more.
- [x] Task: Update `ReadingRoom.tsx` for New Flow — 3891b28
  - [x] Wire up the `VerdictPopup` + `SwipeContainer` for the full cycle: Vote → Pop-up → Acknowledge → Swipe → Next Duel.
  - [x] Replace the "Next Duel" button that navigates to Anthology with one that loads the next pre-fetched duel.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Verdict Pop-Up & Swipe Transitions' (Protocol in workflow.md) — 198c278

## Phase 3: Source Attribution & Final UI Polishing [checkpoint: 35e9c35]

**Goal:** Display detailed poem provenance and refine the "Digital Letterpress" aesthetic.

- [x] Task: Update `DuelStats` Frontend Type — 91f8a22
  - [x] Update `DuelStats` interface in `apps/web/lib/api.ts` so `duel.poemA` and `duel.poemB` include `sourceInfo` (matching the API's `GET /duels/:id/stats` response shape).
- [x] Task: Implement `SourceInfo` Component — 91f8a22
  - [x] Create `apps/web/components/SourceInfo.tsx`.
  - [x] Consume `sourceInfo` from the stats payload via the updated `DuelStats` type.
  - [x] Format human attributions (Author + Source) and AI attributions (Model name).
- [x] Task: Update `Foyer.tsx` to Use `topicMeta` — 91f8a22
  - [x] Replace `featuredDuel.topic` with `featuredDuel.topicMeta.label` for display.
- [x] Task: Final Aesthetic Pass — 91f8a22
  - [x] Audit all screens for Alabaster/Ink consistency.
  - [x] Optimize typography (line heights, kerning) for reading focus.
  - [x] Refine mobile touch targets for topic chips (44x44px).
- [x] Task: Conductor - User Manual Verification 'Phase 3: Source Attribution & Final UI Polishing' (Protocol in workflow.md) — 35e9c35

## Phase 4: Regression & Quality Gate [checkpoint: 871a6cc]

**Goal:** Ensure full-stack correctness and performance across all screens.

- [x] Task: Coverage and Regression Verification — dc1e85c
  - [x] Execute `pnpm --filter @sanctuary/web build`.
  - [x] Execute `pnpm lint`.
  - [x] Execute `pnpm format:check`.
- [x] Task: Regression Checklist (Feature Behaviors) — dc1e85c
  - [x] Verify `GET /topics` returns canonical topics.
  - [x] Verify `GET /duels?topic_id=...` filters correctly.
  - [x] Verify topic filtering works on both desktop and mobile.
  - [x] Confirm Verdict pop-up appears after vote and swipe-out animates after acknowledgment.
  - [x] Confirm sliding window pre-fetching delivers instant "Next Duel" transitions.
  - [x] Ensure source attribution correctly identifies Human vs AI poems.
- [x] Task: E2E Test Suite Update — dc1e85c
  - [x] Update `packages/e2e/tests/ui/` to reflect new navigation, pop-up, and topic filtering.
  - [x] Add specific tests for topic filtering in the Anthology.
  - [x] See `docs/tickets/E2E-ANIMATION-TESTING.md` for animation-specific testing guidance.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md) — 871a6cc

## Phase 5: Documentation

**Goal:** Update project docs to reflect the completed frontend experience.

- [x] Task: Documentation Update — 3056a61
  - [x] Document new frontend components and their interaction patterns.
  - [x] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 6 completion.
