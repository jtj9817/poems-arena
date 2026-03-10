# Specification: Randomized Duel Ordering

## Overview
Currently, `GET /duels` returns duels ordered chronologically (`created_at DESC`), meaning every user sees the same sequence. This track introduces a seeded pseudo-random ordering system. Users will encounter duels in a varied sequence that maintains session-level consistency (no repeated duels within a session) without breaking the sliding-window pagination system.

## Functional Requirements
- **API `GET /duels` Updates:**
  - Introduce a `seed` parameter (integer).
  - The `seed` is **required** by default. If omitted, the API must return an error (e.g., `400 Bad Request` with `MISSING_SEED`), *unless* a specific bypass parameter (like `sort=recent`) is provided for chronological views.
  - Hash the `seed` to create a pivot `duel_id` (e.g., `duel-<12 hex chars>`).
  - Order the returned `duels` rows relative to the pivot: first `duels.id >= pivotId` ordered by `id ASC`, then `duels.id < pivotId` ordered by `id ASC`.
- **Frontend Changes:**
  - **Session Seed:** Generate a random integer seed at session start and store it in `sessionStorage` (`apps/web/lib/session.ts`).
  - **Home & The Ring:** Send the stored `seed` in `GET /duels` requests to fetch randomized sequences.
  - **Past Bouts (Archive):** Update the API request for Past Bouts to explicitly request chronological ordering (e.g., `sort=recent`) to bypass the new seed requirement, preserving its chronological view.
  - **Page Size Fix:** Update `TheRing.tsx` to correctly handle `PAGE_SIZE` so it matches the API's returned limit (12), enabling accurate detection of the last page.

## Non-Functional Requirements
- **Performance:** The seeded rotation must leverage the existing pseudo-random distribution of `duels.id` and operate efficiently via SQL `ORDER BY`, without loading all IDs into memory.
- **Statelessness:** The backend API must remain fully stateless.

## Acceptance Criteria
- [ ] API `GET /duels` returns a `400` error if `seed` is omitted and no chronological override is present.
- [ ] API correctly rotates duel ordering deterministically based on the provided `seed`.
- [ ] The `Home` page features a randomly selected duel that is consistent within the same browser session.
- [ ] `TheRing` maintains a continuous, paginated flow of randomly ordered duels without duplicates within a session.
- [ ] The `PAGE_SIZE` bug is resolved so `TheRing` successfully detects the end of the duel queue.
- [ ] `PastBouts` continues to display duels in chronological (`created_at DESC`) order.

## Out of Scope
- User account-level seed persistence (seeds are strictly session-based).
- Dedicated "Duel of the Day" logic (handled separately via `featured_duels`).