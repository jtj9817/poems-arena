# Implementation Plan: Randomized Duel Ordering

## Phase 1: API Seeded Rotation Logic

**Goal:** Add deterministic seeded rotation to `GET /duels` while enforcing seed usage for random consumers and preserving archive chronology through an explicit bypass.

- [ ] Task: Implement `buildSeedPivot` Utility
  - [ ] Add a small helper in `apps/api/src/routes/duels.ts` or a new adjacent utility file that hashes a numeric seed into a stable duel-shaped pivot ID (`duel-<12 hex chars>`).
  - [ ] Reuse the existing SHA-256 approach already used for duel ID generation so the pivot format matches the duel corpus.
  - [ ] Write focused tests for `buildSeedPivot` to verify deterministic output and stable formatting.
- [ ] Task: Update `GET /duels` Route
  - [ ] Modify `apps/api/src/routes/duels.ts` to accept `seed` and `sort` query parameters alongside the existing `page` and `topic_id` params.
  - [ ] Validate `seed` when present. Reject non-integer or negative values with `400 Bad Request` and an `INVALID_SEED` error code.
  - [ ] Reject requests that omit `seed` unless `sort=recent` is supplied, returning `400 Bad Request` with a `MISSING_SEED` error code.
  - [ ] Preserve chronological `created_at DESC` ordering only for the explicit `sort=recent` bypass used by archive consumers.
  - [ ] When `seed` is present, order by `CASE WHEN duels.id >= pivotId THEN 0 ELSE 1 END`, then `duels.id ASC`, so the seed rotates a stable traversal over the existing hash-distributed duel IDs.
- [ ] Task: Update API Tests
  - [ ] Extend `apps/api/src/routes/duels.test.ts` with failing tests first for missing and invalid seed validation.
  - [ ] Add tests proving the same seed returns the same first-page ordering across repeated requests.
  - [ ] Add tests proving different seeds shift the first-page ordering when enough duel rows exist.
  - [ ] Add tests proving seeded pagination does not repeat IDs across page boundaries for a stable dataset.
  - [ ] Add tests proving `sort=recent` bypasses the seed requirement and still supports `topic_id` filtering.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: API Seeded Rotation Logic' (Protocol in workflow.md)

## Phase 2: Frontend Integration & Pagination Fix

**Goal:** Apply session-scoped seeded ordering to Home and The Ring while keeping Past Bouts chronological via `sort=recent` and fixing the queue page-size bug.

- [ ] Task: Session Seed Utility
  - [ ] Create `apps/web/lib/session.ts` with `getSessionSeed()` to generate and persist a stable integer seed in `sessionStorage` for the current browser tab.
  - [ ] Regenerate the seed if the stored value is missing, malformed, or negative.
  - [ ] Add unit tests in `apps/web/lib/session.test.ts` for first-run generation, same-session reuse, and malformed stored values.
- [ ] Task: Update API Client
  - [ ] Update `apps/web/lib/api.ts` so `getDuels(page, topicId, seed?, sort?)` can send either a required randomization seed or the explicit archive bypass.
  - [ ] Extend `apps/web/lib/api.test.ts` to cover seeded query-param serialization and `sort=recent`.
- [ ] Task: Integrate Home and The Ring
  - [ ] Update `apps/web/pages/Home.tsx` to call `api.getDuels(1, undefined, getSessionSeed())` so the featured duel becomes session-randomized instead of globally newest-first.
  - [ ] Update `apps/web/pages/TheRing.tsx` to read the session seed once and pass it to every `api.getDuels(...)` call, including queue bootstrap and incremental page fetches.
  - [ ] Preserve the existing deep-link behavior where a specifically requested duel is shown first and the seeded stream resumes after it.
- [ ] Task: Fix Queue Page Size Assumption
  - [ ] Update `PAGE_SIZE` in `apps/web/pages/TheRing.tsx` from `10` to `12`, or extract a shared constant that matches the API page size.
  - [ ] Verify `isLastPage` detection now matches the API's real archive page size and does not trigger a spurious extra fetch.
- [ ] Task: Preserve Past Bouts Chronology
  - [ ] Update `apps/web/pages/PastBouts.tsx` to pass `sort: 'recent'` so archive browsing remains chronological under the required-seed API contract.
  - [ ] Confirm topic filtering continues to work through the `sort=recent` path.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Frontend Integration & Pagination Fix' (Protocol in workflow.md)

## Phase 3: Regression & Quality Gate

**Goal:** Lock in correctness with a regression pass before writing final documentation.

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute `pnpm --filter @sanctuary/api test` and resolve failures related to this track.
  - [ ] Execute `pnpm --filter @sanctuary/web test` and resolve failures related to this track.
  - [ ] Execute `pnpm run lint`.
  - [ ] Execute `pnpm format:check` (or `pnpm format` to fix).
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify the same browser tab keeps the same Home featured duel across reloads.
  - [ ] Verify a new browser tab or cleared `sessionStorage` produces a different Home/The Ring ordering.
  - [ ] Verify The Ring paginates through seeded duel IDs without duplicates in a stable dataset.
  - [ ] Verify Past Bouts continues to render chronological results and topic filtering still works through `sort=recent`.
  - [ ] Verify missing `seed` requests fail with `400` and `MISSING_SEED`.
  - [ ] Verify invalid `seed` values receive `400` with `INVALID_SEED`.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Regression & Quality Gate' (Protocol in workflow.md)
  - [ ] Automation script: `scripts/verify-phase3-randomized-duel-ordering.ts`.
  - [ ] Shell wrapper: `scripts/run-manual-verification-phase-3.sh`.

## Phase 4: Documentation

**Goal:** Document the shipped feature.

- [ ] Task: Documentation Update
  - [ ] Document the required `seed` contract, the `sort=recent` archive bypass, and the `INVALID_SEED` / `MISSING_SEED` errors in `docs/backend/api-reference.md`.
  - [ ] Update `docs/frontend/components.md` to describe the session-seeded Home and The Ring behavior, the `sort=recent` Past Bouts path, and the corrected `getDuels` client signature.
  - [ ] If implementation details diverge from `docs/plans/002-duel-randomization-plan.md`, record the final shipped behavior there as well.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Documentation' (Protocol in workflow.md)
  - [ ] Automation script: `scripts/verify-phase4-randomized-duel-ordering.ts`.
  - [ ] Shell wrapper: `scripts/run-manual-verification-phase-4.sh`.
