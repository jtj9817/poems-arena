# Specification: Randomized Duel Ordering

## Overview
Currently, `GET /duels` returns duels in chronological order (`created_at DESC`), so every user sees the same ordering and the Home page always surfaces the newest duel first. This track introduces seeded rotation for session-based discovery on Home and The Ring and makes `seed` mandatory by default, while preserving chronological archive behavior through an explicit `sort=recent` bypass for Past Bouts.

## Functional Requirements
- **API `GET /duels` updates:**
  - Introduce a `seed` query parameter (integer) that is required unless `sort=recent` is provided.
  - If `seed` is present, hash it into a pivot duel ID shaped like `duel-<12 hex chars>`.
  - If `seed` is present, order rows by `CASE WHEN duels.id >= pivotId THEN 0 ELSE 1 END`, then `duels.id ASC`.
  - If `seed` is absent and `sort=recent` is not present, return `400 Bad Request` with code `MISSING_SEED`.
  - If `sort=recent` is present, preserve the current `created_at DESC` behavior.
  - Validate `seed` when present. Invalid values must return `400 Bad Request` with code `INVALID_SEED`.
  - Keep the response shape unchanged.
- **Frontend changes:**
  - **Session seed:** Add `apps/web/lib/session.ts` with `getSessionSeed()` that stores a stable integer seed in `sessionStorage` for the current tab session.
  - **Home and The Ring:** Send the stored `seed` in `GET /duels` requests so both views consume the same session ordering.
  - **Past Bouts:** Call `GET /duels` with `sort=recent` so the archive remains chronological under the required-seed API contract.
  - **Queue page size:** Update `apps/web/pages/TheRing.tsx` so its `PAGE_SIZE` assumption matches the API limit of `12`, allowing correct last-page detection.
  - **Deep links:** When The Ring is opened with an explicit duel ID, that duel should still render first, then navigation should continue through the seeded queue.

## Non-Functional Requirements
- **Performance:** Seeded rotation must be implemented with SQL ordering over the existing `duels.id` indexable text values. The API must not fetch the full duel corpus into memory for shuffling.
- **Statelessness:** The backend remains stateless. Ordering is derived entirely from request parameters.
- **Determinism:** For a stable dataset, the same `seed`, `page`, and `topic_id` inputs must return the same duel ordering.
- **Compatibility:** Existing no-seed consumers must be updated to send either `seed` or `sort=recent`; only the explicit archive bypass remains chronological.

## Acceptance Criteria
- [ ] API `GET /duels` requires `seed` unless `sort=recent` is supplied.
- [ ] API returns `400 MISSING_SEED` when neither `seed` nor `sort=recent` is supplied.
- [ ] API rejects malformed `seed` values with `INVALID_SEED`.
- [ ] API returns a deterministic seeded rotation when `seed` is present.
- [ ] API continues returning chronological `created_at DESC` results for `sort=recent`.
- [ ] The Home page surfaces a session-randomized featured duel that stays stable across reloads in the same tab.
- [ ] The Ring maintains a continuous seeded queue across page fetches without duplicate IDs in a stable dataset.
- [ ] The `PAGE_SIZE` mismatch is fixed so The Ring detects the end of the duel list correctly.
- [ ] Past Bouts continues to display duels chronologically, including when topic filters are applied.

## Edge Cases and Notes
- **Malformed stored seed:** If `sessionStorage` contains a non-numeric or invalid seed, the frontend should regenerate it instead of sending bad input to the API.
- **Small duel pools:** If fewer than 12 duels exist, seeded ordering still applies; the single page is simply rotated.
- **New duels during an active session:** If the duel dataset changes between page fetches, a seeded pagination session can shift. This is acceptable for this track because the API remains stateless.
- **Topic filtering:** `topic_id` filtering applies before ordering. Seeded rotation only affects the filtered result set, and `sort=recent` must still respect topic filtering.

## Out of Scope
- User-account or cross-device seed persistence.
- A separate curated "duel of the day" feature.
