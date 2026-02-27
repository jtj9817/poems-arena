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

## Phase 1: Topic Filtering Infrastructure

**Goal:** Implement the data fetching and state management for canonical topics on the Anthology page.

- [ ] Task: Update `apps/web/lib/api.ts` for Topic Support
  - [ ] Add `getTopics()` to fetch `GET /api/v1/topics`.
  - [ ] Update `getDuels(page, topicId?)` to support optional `topic_id` query parameter.
  - [ ] Update `DuelListItem` to include `topicMeta: TopicMeta` (matching the API response shape).
- [ ] Task: Implement `TopicBar` Component
  - [ ] Create `apps/web/components/TopicBar.tsx`.
  - [ ] Implement sticky horizontal scroll for topic chips.
  - [ ] Support active/inactive states for single-select.
- [ ] Task: Implement `BottomSheetFilter` for Mobile
  - [ ] Create `apps/web/components/BottomSheetFilter.tsx` (using vanilla CSS transitions).
  - [ ] Integrate with `TopicBar` for mobile-specific rendering.
- [ ] Task: Integrate Filtering into `Anthology.tsx`
  - [ ] Remove hardcoded `categories` array and replace with dynamic topics from `getTopics()`.
  - [ ] Fetch topics on mount.
  - [ ] Update duel list when a topic is selected (using `getDuels(page, topicId)`).
  - [ ] Display `topicMeta.label` on `DuelCard` components instead of the raw `topic` string.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Topic Filtering Infrastructure' (Protocol in workflow.md)

## Phase 2: Verdict Pop-Up & Swipe Transitions

**Goal:** Implement the Verdict as a pop-up overlay and add "swipe-like" transitions for continuous duel flow.

- [ ] Task: Refactor Verdict into Pop-Up Component
  - [ ] Extract the existing Verdict overlay from `ReadingRoom.tsx` into a dedicated `apps/web/components/VerdictPopup.tsx`.
  - [ ] Display Verdict as a centered pop-up modal after vote submission.
  - [ ] Include an "Acknowledge" action (e.g., "Continue" button) that dismisses the pop-up.
- [ ] Task: Implement `SwipeContainer` Component
  - [ ] Create `apps/web/components/SwipeContainer.tsx` using CSS Keyframes for swipe animations.
  - [ ] Trigger the swipe-out transition for the current duel **after** the user acknowledges the Verdict pop-up.
  - [ ] Trigger a swipe-in transition for the next duel.
- [ ] Task: Implement Sliding Window Pre-Fetching
  - [ ] On first duel entry, fetch the ordered duel ID list via `getDuels()` and store as a queue in client state.
  - [ ] Pre-fetch the next 1–2 full duels (`getDuel(id)`) while the user reads the current duel.
  - [ ] On "Next Duel" acknowledgment, advance the queue and pre-fetch the next duel.
  - [ ] When approaching the end of the current page of IDs, fetch `getDuels(nextPage)` for more.
- [ ] Task: Update `ReadingRoom.tsx` for New Flow
  - [ ] Wire up the `VerdictPopup` + `SwipeContainer` for the full cycle: Vote → Pop-up → Acknowledge → Swipe → Next Duel.
  - [ ] Replace the "Next Duel" button that navigates to Anthology with one that loads the next pre-fetched duel.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Verdict Pop-Up & Swipe Transitions' (Protocol in workflow.md)

## Phase 3: Source Attribution & Final UI Polishing

**Goal:** Display detailed poem provenance and refine the "Digital Letterpress" aesthetic.

- [ ] Task: Update `DuelStats` Frontend Type
  - [ ] Update `DuelStats` interface in `apps/web/lib/api.ts` so `duel.poemA` and `duel.poemB` include `sourceInfo` (matching the API's `GET /duels/:id/stats` response shape).
- [ ] Task: Implement `SourceInfo` Component
  - [ ] Create `apps/web/components/SourceInfo.tsx`.
  - [ ] Consume `sourceInfo` from the stats payload via the updated `DuelStats` type.
  - [ ] Format human attributions (Author + Source) and AI attributions (Model name).
- [ ] Task: Update `Foyer.tsx` to Use `topicMeta`
  - [ ] Replace `featuredDuel.topic` with `featuredDuel.topicMeta.label` for display.
- [ ] Task: Final Aesthetic Pass
  - [ ] Audit all screens for Alabaster/Ink consistency.
  - [ ] Optimize typography (line heights, kerning) for reading focus.
  - [ ] Refine mobile touch targets for topic chips (44x44px).
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Source Attribution & Final UI Polishing' (Protocol in workflow.md)

## Phase 4: Regression & Quality Gate

**Goal:** Ensure full-stack correctness and performance across all screens.

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute `pnpm --filter @sanctuary/web build`.
  - [ ] Execute `pnpm lint`.
  - [ ] Execute `pnpm format:check`.
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify `GET /topics` returns canonical topics.
  - [ ] Verify `GET /duels?topic_id=...` filters correctly.
  - [ ] Verify topic filtering works on both desktop and mobile.
  - [ ] Confirm Verdict pop-up appears after vote and swipe-out animates after acknowledgment.
  - [ ] Confirm sliding window pre-fetching delivers instant "Next Duel" transitions.
  - [ ] Ensure source attribution correctly identifies Human vs AI poems.
- [ ] Task: E2E Test Suite Update
  - [ ] Update `packages/e2e/tests/ui/` to reflect new navigation, pop-up, and topic filtering.
  - [ ] Add specific tests for topic filtering in the Anthology.
  - [ ] See `docs/tickets/E2E-ANIMATION-TESTING.md` for animation-specific testing guidance.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

**Goal:** Update project docs to reflect the completed frontend experience.

- [ ] Task: Documentation Update
  - [ ] Document new frontend components and their interaction patterns.
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 6 completion.
