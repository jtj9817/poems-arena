# [BUG] Frontend and E2E Tests Broken by `/duels/today` API Deprecation

**Issue Type:** Bug / Regression
**Severity:** Critical
**Status:** Resolved
**Component:** Frontend (`apps/web`), Tests (`packages/e2e`)

## Description

The Phase 5 "API Updates" track explicitly deprecated and removed the `GET /duels/today` endpoint in `apps/api/src/routes/duels.ts` (replaced with a 404 `ENDPOINT_NOT_FOUND` error). However, the corresponding frontend clients and E2E tests were not updated to reflect this change, leading to a complete failure of the core user journey in the test environment.

The track plan marked the task `- [x] Remove/update callers and tests that depend on GET /duels/today.` as complete, but this was only partially done (API callers maybe, but not the frontend client).

## Current Behavior

Running `pnpm test` at the project root fails because the `packages/e2e` Playwright UI tests attempt to load the daily duel using the deprecated endpoint.
Specifically, `apps/web/lib/api.ts` still contains:

```typescript
  getTodaysDuel(): Promise<AnonymousDuel> {
    return request('/duels/today');
  }
```

Which is invoked by `apps/web/pages/ReadingRoom.tsx`. Since the endpoint now returns a `404`, the frontend fails to load the reading room.

## Expected Behavior

The frontend and E2E tests should be updated to rely on the new API design. Since `/duels/today` is no longer available, the frontend needs an alternative mechanism to fetch the day's featured duel (e.g., fetching `GET /duels` and selecting a duel ID to navigate to `GET /duels/:id`).

## Steps to Reproduce

1. Run the local development server (or test server).
2. Execute the E2E test suite: `pnpm test`
3. Observe failures in `navigation.spec.ts` and `reading-room.spec.ts` due to missing elements (because the page failed to load the duel payload).

## Suggested Fix

1. **Frontend Update:** Update `apps/web/lib/api.ts` and `apps/web/pages/ReadingRoom.tsx` (and `Foyer.tsx` if applicable) to utilize `GET /duels` and `GET /duels/:id`.
2. **E2E Test Update:** Ensure `packages/e2e` tests align with the new frontend logic.

## Resolution

**Resolved on:** 2026-02-26

### Changes Made

- **`apps/web/lib/api.ts`** — Removed dead `getTodaysDuel()` method.
- **`apps/web/App.tsx`** — Added `activeDuelId` state and `navigate(view, duelId?)` to pass duel IDs through the view system.
- **`apps/web/pages/Foyer.tsx`** — Fetches `GET /duels` on mount, displays first duel's real topic (replaced hardcoded "Melancholy"), passes duel ID on navigation. Includes loading state and empty-state fallback.
- **`apps/web/pages/ReadingRoom.tsx`** — Accepts `duelId` prop, uses `api.getDuel(duelId)` instead of `api.getTodaysDuel()`. Falls back to fetching duel list if no ID provided.
- **`apps/web/pages/Anthology.tsx`** — Duel cards are now clickable, navigating to the Reading Room with the selected duel's ID.
- **`apps/web/tsconfig.json`** — Added `"vite/client"` to types (pre-existing build fix for `import.meta.env`).

### Verification

- `pnpm --filter @sanctuary/web build` — passes (tsc + vite)
- `pnpm lint` — passes
- `pnpm format:check` — passes on all changed files
- `pnpm --filter @sanctuary/e2e test` — 22/22 passed (0 failures), including all UI tests (foyer, navigation, reading-room, anthology)
