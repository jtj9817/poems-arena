# Implementation Plan: Randomized Duel Ordering

## Phase 1: API Seeded Rotation Logic

**Goal:** Add deterministic seeded rotation to `GET /duels` while enforcing seed usage for random consumers and preserving archive chronology through an explicit bypass.

- [x] Task: Implement `buildSeedPivot` Utility (8d58265)
  - [x] Add a small helper in `apps/api/src/routes/duels.ts` or a new adjacent utility file that hashes a numeric seed into a stable duel-shaped pivot ID (`duel-<12 hex chars>`).
  - [x] Reuse the existing SHA-256 approach already used for duel ID generation so the pivot format matches the duel corpus.
  - [x] Write focused tests for `buildSeedPivot` to verify deterministic output and stable formatting.
- [x] Task: Update `GET /duels` Route (f49b369)
  - [x] Modify `apps/api/src/routes/duels.ts` to accept `seed` and `sort` query parameters alongside the existing `page` and `topic_id` params.
  - [x] Validate `seed` when present. Reject non-integer or negative values with `400 Bad Request` and an `INVALID_SEED` error code.
  - [x] Reject requests that omit `seed` unless `sort=recent` is supplied, returning `400 Bad Request` with a `MISSING_SEED` error code.
  - [x] Preserve chronological `created_at DESC` ordering only for the explicit `sort=recent` bypass used by archive consumers.
  - [x] When `seed` is present, order by `CASE WHEN duels.id >= pivotId THEN 0 ELSE 1 END`, then `duels.id ASC`, so the seed rotates a stable traversal over the existing hash-distributed duel IDs.
- [x] Task: Update API Tests (f49b369)
  - [x] Extend `apps/api/src/routes/duels.test.ts` with failing tests first for missing and invalid seed validation.
  - [x] Add tests proving the same seed returns the same first-page ordering across repeated requests.
  - [x] Add tests proving different seeds shift the first-page ordering when enough duel rows exist.
  - [x] Add tests proving seeded pagination does not repeat IDs across page boundaries for a stable dataset.
  - [x] Add tests proving `sort=recent` bypasses the seed requirement and still supports `topic_id` filtering.
- [x] Task: Conductor - User Manual Verification 'Phase 1: API Seeded Rotation Logic' (Protocol in workflow.md) (0b5f773)
  - Verification script: `scripts/verify-phase1-randomized-duel-ordering.ts`
  - Result: 23/23 checks passed

## Phase 2: Frontend Integration & Pagination Fix

**Goal:** Apply session-scoped seeded ordering to Home and The Ring while keeping Past Bouts chronological via `sort=recent` and fixing the queue page-size bug.

- [x] Task: Session Seed Utility (c84e8c9)
  - [x] Create `apps/web/lib/session.ts` with `getSessionSeed()` to generate and persist a stable integer seed in `sessionStorage` for the current browser tab.
  - [x] Regenerate the seed if the stored value is missing, malformed, or negative.
  - [x] Add unit tests in `apps/web/lib/session.test.ts` for first-run generation, same-session reuse, and malformed stored values.
- [x] Task: Update API Client (c84e8c9)
  - [x] Update `apps/web/lib/api.ts` so `getDuels(page, topicId, seed?, sort?)` can send either a required randomization seed or the explicit archive bypass.
  - [x] Extend `apps/web/lib/api.test.ts` to cover seeded query-param serialization and `sort=recent`.
- [x] Task: Integrate Home and The Ring (c84e8c9)
  - [x] Update `apps/web/pages/Home.tsx` to call `api.getDuels(1, undefined, getSessionSeed())` so the featured duel becomes session-randomized instead of globally newest-first.
  - [x] Update `apps/web/pages/TheRing.tsx` to read the session seed once and pass it to every `api.getDuels(...)` call, including queue bootstrap and incremental page fetches.
  - [x] Preserve the existing deep-link behavior where a specifically requested duel is shown first and the seeded stream resumes after it.
- [x] Task: Fix Queue Page Size Assumption (c84e8c9)
  - [x] Update `PAGE_SIZE` in `apps/web/pages/TheRing.tsx` from `10` to `12`, or extract a shared constant that matches the API page size.
  - [x] Verify `isLastPage` detection now matches the API's real archive page size and does not trigger a spurious extra fetch.
- [x] Task: Preserve Past Bouts Chronology (c84e8c9)
  - [x] Update `apps/web/pages/PastBouts.tsx` to pass `sort: 'recent'` so archive browsing remains chronological under the required-seed API contract.
  - [x] Confirm topic filtering continues to work through the `sort=recent` path.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Frontend Integration & Pagination Fix' (Protocol in workflow.md) (d973566)
  - Verification script: `scripts/verify-phase2-randomized-duel-ordering.ts`
  - Result: 18/18 checks passed

## Phase 3: Regression & Quality Gate

**Goal:** Lock in correctness with a regression pass before writing final documentation.

- [x] Task: Coverage and Regression Verification (4aa3cca)
  - [x] Execute `pnpm --filter @sanctuary/api test` and resolve failures related to this track.
  - [x] Execute `pnpm --filter @sanctuary/web test` and resolve failures related to this track.
  - [x] Execute `pnpm run lint`.
  - [x] Execute `pnpm format:check` (or `pnpm format` to fix).
- [x] Task: Regression Checklist (Feature Behaviors) (4aa3cca)
  - [x] Verify the same browser tab keeps the same Home featured duel across reloads.
  - [x] Verify a new browser tab or cleared `sessionStorage` produces a different Home/The Ring ordering.
  - [x] Verify The Ring paginates through seeded duel IDs without duplicates in a stable dataset.
  - [x] Verify Past Bouts continues to render chronological results and topic filtering still works through `sort=recent`.
  - [x] Verify missing `seed` requests fail with `400` and `MISSING_SEED`.
  - [x] Verify invalid `seed` values receive `400` with `INVALID_SEED`.
- [x] Task: Conductor - User Manual Verification 'Phase 3: Regression & Quality Gate' (Protocol in workflow.md) (4aa3cca)
  - [x] Automation script: `scripts/verify-phase3-randomized-duel-ordering.ts`.
  - [x] Shell wrapper: `scripts/run-manual-verification-phase-3-randomized-duel-ordering.sh`.
  - Result: 14/14 checks passed (`phase3_randomized_duel_ordering_2026-03-11T05_07_45_831Z`).

## Phase 4: Documentation

**Goal:** Document the shipped feature.

- [x] Task: Documentation Update (d7f8f6d)
  - [x] Document the required `seed` contract, the `sort=recent` archive bypass, and the `INVALID_SEED` / `MISSING_SEED` errors in `docs/backend/api-reference.md`.
  - [x] Update `docs/frontend/components.md` to describe the session-seeded Home and The Ring behavior, the `sort=recent` Past Bouts path, and the corrected `getDuels` client signature.
  - [x] If implementation details diverge from `docs/plans/002-duel-randomization-plan.md`, record the final shipped behavior there as well.
- [x] Task: Conductor - User Manual Verification 'Phase 4: Documentation' (Protocol in workflow.md) (d7f8f6d)
  - [x] Automation script: `scripts/verify-phase4-randomized-duel-ordering.ts`.
  - [x] Shell wrapper: `scripts/run-manual-verification-phase-4-randomized-duel-ordering.sh`.
  - Result: 8/8 checks passed (`phase4_randomized_duel_ordering_2026-03-12T03_19_28_632Z`).
