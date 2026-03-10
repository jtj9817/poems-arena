# Implementation Plan: Randomized Duel Ordering

## Phase 1: API Seeded Rotation Logic

**Goal:** Update the backend to support deterministic seeded rotation and enforce the seed requirement.

- [ ] Task: Implement `buildSeedPivot` Utility
  - [ ] Create function to hash an integer seed into a 12-character hex pivot ID (e.g. `duel-<hash>`) in `apps/api/src/routes/duels.ts` or a new utils file.
  - [ ] Write unit tests for `buildSeedPivot` to ensure deterministic output.
- [ ] Task: Update `GET /duels` Route
  - [ ] Modify `apps/api/src/routes/duels.ts` to accept `seed` (integer) and `sort` (string) query parameters.
  - [ ] Add validation: If `seed` is missing and `sort` is not equal to `recent`, throw a `400 Bad Request` with `MISSING_SEED`.
  - [ ] Implement conditional ordering logic in Drizzle:
    - If `seed` is provided, order by `CASE WHEN duels.id >= pivotId THEN 0 ELSE 1 END`, then `duels.id ASC`.
    - If `sort=recent` is provided, order by `created_at DESC` (existing logic).
- [ ] Task: Update API Tests
  - [ ] Write/update tests in `apps/api/src/routes/duels.test.ts` to verify the `400` error when seed is missing.
  - [ ] Write tests verifying `sort=recent` bypasses the seed requirement and returns chronological order.
  - [ ] Write tests verifying that providing a `seed` returns a stable rotation of duels.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: API Seeded Rotation Logic' (Protocol in workflow.md)

## Phase 2: Frontend Integration & Pagination Fix

**Goal:** Fix the `PAGE_SIZE` issue and integrate the new `seed` / `sort` parameters across the frontend.

- [ ] Task: Session Seed Utility
  - [ ] Create `apps/web/lib/session.ts` with `getSessionSeed()` to generate/retrieve a stable integer seed from `sessionStorage`.
  - [ ] Add unit tests in `apps/web/lib/session.test.ts`.
- [ ] Task: Update API Client (`api.ts`)
  - [ ] Update `getDuels(page, topicId, seed, sort)` signature in `apps/web/lib/api.ts` to accept the new `seed` and `sort` parameters.
- [ ] Task: Integrate Home and TheRing
  - [ ] Update `apps/web/pages/Home.tsx` to pass `getSessionSeed()` to `getDuels`.
  - [ ] Update `apps/web/pages/TheRing.tsx` to read the session seed once (e.g., via `useRef` or on mount) and pass it to all `getDuels` calls.
- [ ] Task: Fix PAGE_SIZE in TheRing
  - [ ] Update `PAGE_SIZE` to `12` in `TheRing.tsx` (or extract to a shared constant) to correctly detect the end of the duel queue.
- [ ] Task: Integrate Past Bouts
  - [ ] Update `apps/web/pages/PastBouts.tsx` (Anthology) to explicitly pass `sort: 'recent'` when calling `getDuels`, preserving chronological order.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Frontend Integration & Pagination Fix' (Protocol in workflow.md)

## Phase 3: Regression & Quality Gate

**Goal:** Lock in correctness with a regression pass before writing final documentation.

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute `pnpm --filter @sanctuary/api test` and `pnpm --filter @sanctuary/web test` (if applicable) and resolve failures.
  - [ ] Execute `pnpm run lint`.
  - [ ] Execute `pnpm format:check` (or `pnpm format` to fix).
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify `Home` loads a duel that remains consistent upon refreshing the page.
  - [ ] Verify `TheRing` navigates through duels seamlessly without duplicating duels within a session.
  - [ ] Verify `PastBouts` successfully loads chronological duels.
  - [ ] Verify API rejects requests missing both `seed` and `sort=recent`.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 4: Documentation

**Goal:** Document the shipped feature.

- [ ] Task: Documentation Update
  - [ ] Document the new `seed` and `sort` parameters in `docs/backend/api-reference.md`.
  - [ ] Update `docs/frontend/components.md` to note the session-based seeded behavior for `Home` and `TheRing`.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Documentation' (Protocol in workflow.md)