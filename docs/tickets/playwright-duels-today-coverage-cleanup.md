# PLAYWRIGHT-DUELS-001 — Remove Stale `/duels/today` Coverage from Playwright API Tests

**Component:** `packages/e2e/tests/api/duels.spec.ts`
**Severity:** Medium
**Type:** Test Debt / Regression Risk
**Status:** Resolved

---

## Summary

The Playwright API suite still contains coverage built around `GET /duels/today`, even though that endpoint was intentionally removed and now returns `404 ENDPOINT_NOT_FOUND` from the API router. The stale coverage is no longer validating the active contract and creates noise around duel-related acceptance criteria.

---

## Current Behaviour

`packages/e2e/tests/api/duels.spec.ts` still:

1. calls `GET /duels/today` directly,
2. treats `404` as an acceptable branch for a test that was originally meant to validate duel retrieval,
3. uses `/duels/today` as the setup path for the `GET /duels/:id/stats` happy-path test.

This means the suite is partially exercising a deprecated route instead of the canonical duel discovery flow:

- `GET /duels` to discover IDs
- `GET /duels/:id` to fetch an anonymous duel
- `GET /duels/:id/stats` to fetch reveal metadata

---

## Why It Matters

The stale `/duels/today` coverage weakens test value in three ways:

1. It no longer proves the intended public API flow.
2. It makes duel-related E2E acceptance misleading for follow-up work such as seeded ordering.
3. It normalizes a deprecated endpoint in the test suite, increasing the chance of future confusion or accidental reintroduction.

---

## Reproduction

Open `packages/e2e/tests/api/duels.spec.ts` and inspect:

- `GET /duels/today returns anonymous duel (no author/type on poems)`
- the setup block inside `GET /duels/:id/stats returns full reveal with author and type`

Both still depend on `/duels/today` instead of the current discovery flow.

---

## Expected Behaviour

The Playwright API suite should validate only the live duel contract:

1. `GET /duels` returns a valid list payload.
2. When the list is non-empty, the suite picks a duel ID from that list.
3. `GET /duels/:id` validates the anonymous duel payload.
4. `GET /duels/:id/stats` validates the reveal payload for that same duel ID.
5. `/duels/today` is either removed from Playwright coverage entirely or covered only by an explicit deprecation test that asserts `404 ENDPOINT_NOT_FOUND`.

---

## Root Cause

The frontend migration away from `/duels/today` was completed, but the Playwright API tests retained legacy setup logic. As a result, the suite still reflects the pre-Phase-5 retrieval model rather than the current many-duels-per-day architecture.

---

## Fix Approach

1. Replace `/duels/today`-based happy-path setup with `GET /duels` list discovery.
2. If the list is empty, skip the happy-path duel payload tests explicitly.
3. Use the discovered duel ID for both `/duels/:id` and `/duels/:id/stats` assertions.
4. Decide whether `/duels/today` should:
   - be removed from Playwright coverage entirely, or
   - remain as a small deprecation assertion checking `404` plus `ENDPOINT_NOT_FOUND`.
5. Keep the invalid-ID tests unchanged.

---

## Resolution

**Resolved on:** 2026-03-10  
**Commit:** `3f2449c566d67512f1986144a6779883d812160d` (`test(e2e): align duels coverage with live endpoints`)

### Changes Made

- Updated `packages/e2e/tests/api/duels.spec.ts` to discover duel IDs from `GET /duels` for happy-path coverage.
- Kept `/duels/today` only as explicit deprecation coverage (`404 ENDPOINT_NOT_FOUND`), not as happy-path setup.
- Updated `docs/plans/002-duel-randomization-plan.md` note so it matches the current Playwright contract coverage.

---

## Acceptance Criteria

- [x] `packages/e2e/tests/api/duels.spec.ts` no longer uses `/duels/today` for happy-path duel retrieval.
- [x] The `GET /duels/:id/stats` happy-path test sources its duel ID from `GET /duels`.
- [x] Any remaining `/duels/today` coverage is explicitly framed as deprecation coverage, not feature coverage.
- [x] Duel API Playwright tests remain green against the current API contract.
- [x] Duel randomization work can reference Playwright coverage without caveats about stale `/today` setup.

---

## Affected Surface

| Location | Issue |
|---|---|
| `packages/e2e/tests/api/duels.spec.ts` | Legacy `/duels/today` happy-path coverage |
| `docs/plans/002-duel-randomization-plan.md` | Currently notes this stale coverage as an acceptance-risk caveat |

---

## Out of Scope

- Changes to the API router itself
- Reintroducing `/duels/today`
- Broader Playwright refactors unrelated to duel endpoint coverage
