# Implementation Plan: Phase 6 - Frontend Integration

## Phase 1: Topic Filtering Infrastructure

**Goal:** Implement the data fetching and state management for canonical topics on the Anthology page.

- [ ] Task: Update `apps/web/lib/api.ts` for Topic Support
  - [ ] Add `getTopics()` to fetch `GET /api/v1/topics`.
  - [ ] Update `getDuels(page, topicId?)` to support optional filtering.
- [ ] Task: Implement `TopicBar` Component
  - [ ] Create `apps/web/components/TopicBar.tsx`.
  - [ ] Implement sticky horizontal scroll for topic chips.
  - [ ] Support active/inactive states for single-select.
- [ ] Task: Implement `BottomSheetFilter` for Mobile
  - [ ] Create `apps/web/components/BottomSheetFilter.tsx` (using vanilla CSS transitions).
  - [ ] Integrate with `TopicBar` for mobile-specific rendering.
- [ ] Task: Integrate Filtering into `Anthology.tsx`
  - [ ] Fetch topics on mount.
  - [ ] Update duel list when a topic is selected.
  - [ ] Display `topicMeta` labels on `DuelCard` components.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Topic Filtering Infrastructure' (Protocol in workflow.md)

## Phase 2: Tinder-Like Interaction & Transitions

**Goal:** Create a high-polish, "swipe-like" transition between the Reading Room and the Verdict screen.

- [ ] Task: Implement `SwipeContainer` Component
  - [ ] Create `apps/web/components/SwipeContainer.tsx` using CSS Keyframes for swipe animations.
  - [ ] Manage "Entering" and "Exiting" states for views.
- [ ] Task: Update `ReadingRoom.tsx` for Animations
  - [ ] Wrap poem selections in the swipe transition.
  - [ ] Trigger exit animation on vote submission.
- [ ] Task: Refactor `App.tsx` View Management
  - [ ] Ensure smooth handoff between `ReadingRoom` and `Verdict` overlays.
  - [ ] Support "Next Duel" pre-fetching to maintain momentum.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Tinder-Like Interaction & Transitions' (Protocol in workflow.md)

## Phase 3: Source Attribution & Final UI Polishing

**Goal:** Display detailed poem provenance and refine the "Digital Letterpress" aesthetic.

- [ ] Task: Implement `SourceInfo` Component
  - [ ] Create `apps/web/components/SourceInfo.tsx`.
  - [ ] Parse `sourceInfo` from the stats payload.
  - [ ] Format human attributions (Author + Source) and AI attributions (Model name).
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
  - [ ] Verify topic filtering works on both desktop and mobile.
  - [ ] Confirm "swipe-like" animation is fluid and doesn't jitter.
  - [ ] Ensure source attribution correctly identifies Human vs AI poems.
- [ ] Task: E2E Test Suite Update
  - [ ] Update `packages/e2e/tests/ui/` to reflect new navigation and animations.
  - [ ] Add specific tests for topic filtering in the Anthology.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

**Goal:** Update project docs to reflect the completed frontend experience.

- [ ] Task: Documentation Update
  - [ ] Document new frontend components and their interaction patterns.
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 6 completion.
