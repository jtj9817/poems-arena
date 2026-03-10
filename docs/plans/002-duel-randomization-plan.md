# Plan 002 — Randomized Duel Ordering

**Status:** DRAFT
**Created:** 2026-03-10

---

## 1. Overview

Currently, `GET /duels` returns duels ordered by `created_at DESC` (newest first). Every user sees the same duels in the same order, and the Home page always features the most recently created duel. This plan introduces **seeded pseudo-random ordering** so that users encounter duels in a varied sequence while maintaining session-level consistency (no repeated duels within a session) and working cleanly with the existing pagination and duel queue systems.

---

## 2. Current Architecture

### 2.1 API Layer (`apps/api/src/routes/duels.ts`)

- `GET /duels` accepts `?page=N` (default 1) and optional `?topic_id=<id>`.
- Returns up to **12** results per page, ordered by `duels.created_at DESC`.
- Returns: `id`, `topic`, `topicMeta`, `createdAt`, `humanWinRate`, `avgReadingTime`.

### 2.2 Frontend Consumers

Three distinct consumers call `GET /duels`, each with different needs:

| Consumer | Behavior | Ordering Need |
|----------|----------|---------------|
| **Home.tsx** | Calls `getDuels()` page 1, takes `duels[0]` as "featured duel" | **Random** — should vary per session |
| **TheRing.tsx** | Builds a sliding-window queue from paginated duel IDs; pre-fetches next 2 duels; pages forward on swipe | **Random** — same seed across pages for consistency |
| **PastBouts.tsx** | Archive grid, fetches page 1 with optional topic filter | **Chronological** — archive should stay ordered |

### 2.3 Duel Queue (`apps/web/lib/duelQueue.ts`)

Pure functional sliding-window queue. Stores an ordered list of duel IDs, a current index pointer, page counter, and a `hasMore` flag. The queue is **ordering-agnostic** — it appends IDs from successive API pages regardless of how they were sorted server-side.

### 2.4 Pre-existing Bug: PAGE_SIZE Mismatch

`TheRing.tsx` uses `PAGE_SIZE = 10` to detect the last page (`newIds.length < PAGE_SIZE`), but the API returns up to 12 items. The frontend will never detect the last page until the API returns fewer than 10 items. This should be fixed as a side-commit but is out of scope for this plan.

---

## 3. Approach Options Considered

### Option A: `ORDER BY RANDOM()` (No Session Awareness)

Replace the order clause with SQLite's `RANDOM()`.

- **Fatal flaw:** Each page request produces an independent random ordering. Page 2 may return duels already seen on page 1. Pagination breaks fundamentally.
- **Verdict:** Not viable.

### Option B: Seeded Pseudo-Random Ordering *(Recommended)*

Client sends a `?seed=<integer>` parameter. Server uses it to produce a deterministic permutation via `ORDER BY HEX(duels.id || <seed>)`. Same seed + same page = same results. Different seeds = different orderings.

- **Pros:** Stateless API. Pagination works. No server-side session state. Backwards compatible.
- **Cons:** Client must generate and persist a seed per session. SQLite expression is unconventional (but functional).
- **Verdict:** Best fit for the stateless architecture.

### Option C: Client-Side Shuffle

Fetch all duel IDs in one request, shuffle on the client.

- **Fatal flaw:** Doesn't scale. Defeats pagination. Requires fetching potentially thousands of IDs upfront.
- **Verdict:** Not scalable.

### Option D: Server-Side Session State

Server tracks seen duels per user via cookies or a session store.

- **Fatal flaw:** The API has zero session/auth infrastructure. Introduces server-side state management for a cosmetic feature.
- **Verdict:** Over-engineered.

---

## 4. Recommended Approach: Seeded Pseudo-Random Ordering

### 4.1 Core Mechanism

1. The **frontend** generates a random integer seed at session start, stored in `sessionStorage`.
2. The seed is sent as `?seed=N` on every `GET /duels` call from Home and TheRing.
3. The **API** uses the seed to compute a deterministic sort key: `ORDER BY HEX(duels.id || <seed_string>)`.
4. Because the duel ID is a SHA-256 derived hex string (`duel-<12 hex chars>`), concatenating it with the seed and taking `HEX()` produces a well-distributed, deterministic permutation.
5. **PastBouts** never sends a seed, so it gets the existing `created_at DESC` ordering.

### 4.2 SQL Strategy

```sql
-- When seed is present:
SELECT ... FROM duels
WHERE ...
ORDER BY HEX(duels.id || '839271')
LIMIT 12 OFFSET 0;

-- When seed is absent (backwards compatible):
SELECT ... FROM duels
WHERE ...
ORDER BY duels.created_at DESC
LIMIT 12 OFFSET 0;
```

In Drizzle ORM:

```typescript
const orderExpr = seed !== undefined
  ? sql`HEX(${duels.id} || ${seed.toString()})`
  : desc(duels.createdAt);

const rows = await db
  .select({ ... })
  .from(duels)
  .where(...)
  .orderBy(orderExpr)
  .limit(limit)
  .offset(offset);
```

### 4.3 Featured Duel Behavior

With seeded randomization, `duels[0]` on the Home page becomes the first item in the seeded permutation rather than the newest duel. This means:

- Different sessions see different featured duels (desirable).
- The same session sees a consistent featured duel.
- Refreshing the page generates a new seed and a new featured duel.

If a "duel of the day" concept is wanted later, that's a separate feature using the existing `featured_duels` table.

---

## 5. API Contract Changes

### Modified: `GET /duels`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | Page number (unchanged) |
| `topic_id` | string | _(none)_ | Optional topic filter (unchanged) |
| `seed` | integer | _(none)_ | **New.** When present, results are ordered by a deterministic pseudo-random permutation seeded by this value. When absent, results are ordered by `created_at DESC`. |

**Backwards compatibility:** Fully backwards compatible. `seed` is optional. Omitting it produces identical behavior to today.

**Validation:** `seed` must be a non-negative integer when provided. Invalid values return `400` with code `INVALID_SEED`.

**Response shape:** Unchanged.

---

## 6. Frontend Changes

### 6.1 New: Session Seed Utility

**File:** `apps/web/lib/session.ts` (new)

```typescript
const SEED_KEY = 'duel-seed';

export function getSessionSeed(): number {
  const stored = sessionStorage.getItem(SEED_KEY);
  if (stored !== null) return parseInt(stored, 10);
  const seed = Math.floor(Math.random() * 2147483647);
  sessionStorage.setItem(SEED_KEY, seed.toString());
  return seed;
}
```

### 6.2 Modified: API Client

**File:** `apps/web/lib/api.ts`

Add optional `seed` parameter to `getDuels()`:

```typescript
getDuels(page = 1, topicId?: string, seed?: number): Promise<DuelListItem[]> {
  const params = new URLSearchParams({ page: String(page) });
  if (topicId !== undefined) params.set('topic_id', topicId);
  if (seed !== undefined) params.set('seed', String(seed));
  return request(`/duels?${params}`);
}
```

### 6.3 Modified: Home.tsx

- Import `getSessionSeed`.
- Call `api.getDuels(1, undefined, getSessionSeed())`.

### 6.4 Modified: TheRing.tsx

- Import `getSessionSeed`.
- Store seed in a `useRef` to keep it stable for the component lifetime.
- Pass seed to all `api.getDuels(page, undefined, seed)` calls.

### 6.5 Unchanged: PastBouts.tsx

No changes. Omits `seed`, retains chronological ordering.

### 6.6 Unchanged: duelQueue.ts

The queue is ordering-agnostic. It just stores and iterates IDs. No changes needed.

---

## 7. Edge Cases

### 7.1 Small Duel Pools

If fewer than 12 duels exist (one page), randomization still works. The single page returns all duels in a seeded order. The queue correctly detects no more pages.

### 7.2 Empty Results

If no duels exist, `[]` is returned regardless of seed. Home shows "No duels available yet." No change needed.

### 7.3 New Duels Added Mid-Session

If duels are inserted while a session is active, the seeded permutation changes (the row set changed). This could theoretically cause a duel to appear on two pages or be skipped. In practice this is acceptable because:
- Duel assembly is a batch process, not real-time.
- Sessions are short-lived.
- Worst case: seeing a duel twice or missing one — negligible UX impact.

### 7.4 Seed Collision

Two users with the same seed see the same ordering. With a 31-bit seed space (~2 billion values), collisions are extremely rare and harmless.

### 7.5 Deep-Linking to a Duel

When `TheRing` receives a specific `duelId` (e.g., from PastBouts), it prepends that duel to the queue. The seeded ordering drives "next duel" navigation after the deep-linked one. This works without changes.

### 7.6 Topic Filtering with Seed

`seed` and `topic_id` are orthogonal. The `WHERE` clause filters by topic, the `ORDER BY` uses the seeded permutation over the filtered set.

---

## 8. Files to Create or Modify

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/routes/duels.ts` | Modify | Add `seed` query param parsing; conditional ordering |
| `apps/api/src/errors.ts` | Modify | Add `InvalidSeedError` class |
| `apps/web/lib/session.ts` | Create | `getSessionSeed()` utility |
| `apps/web/lib/api.ts` | Modify | Add `seed` parameter to `getDuels()` |
| `apps/web/pages/Home.tsx` | Modify | Pass session seed to `getDuels` |
| `apps/web/pages/TheRing.tsx` | Modify | Pass session seed to all `getDuels` calls |
| `apps/web/lib/duelQueue.ts` | No change | Queue is ordering-agnostic |
| `apps/web/pages/PastBouts.tsx` | No change | Retains chronological ordering |

---

## 9. Testing Strategy

### 9.1 API Unit Tests

- Same seed → same ordering across multiple requests.
- Different seed → different ordering.
- Pagination consistency: page 2 with seed does not repeat page 1 IDs.
- No seed → chronological ordering (backwards compatibility).
- Seed validation: non-integer, negative, missing values.
- Seed + `topic_id` filter works correctly.

### 9.2 Frontend Unit Tests

- `getSessionSeed()` returns consistent value within a session.
- `getSessionSeed()` generates a new value when `sessionStorage` is empty.
- `getDuels` correctly includes `seed` in URL params when provided.
- `getDuels` omits `seed` from URL params when not provided.

### 9.3 Integration / E2E

- Load Home page, verify featured duel varies between sessions (different seeds).
- Navigate through TheRing queue, verify no duplicate duels within a session.
- PastBouts shows chronological order regardless of session seed.

---

## 10. Deployment and Rollback

### Deployment Order

1. **API first** (or simultaneously with frontend). The `seed` parameter is additive and ignored when absent.
2. **Frontend second.** Even if deployed before the API, Hono does not reject unknown query params — the frontend would just get chronological results until the API catches up.

### Rollback

Remove `seed` from frontend calls → reverts to chronological ordering. No database migration to undo. No data changes.

---

## 11. Future Considerations

- **"Duel of the Day":** The existing `featured_duels` table could be used to curate a daily featured duel, separate from the random session ordering. This would be a dedicated endpoint or a flag on `GET /duels`.
- **Weighted randomization:** Duels with fewer votes could be weighted higher to surface under-voted duels. This would require a more complex sort expression.
- **User-level seed persistence:** If user accounts are added, the seed could be tied to a user profile for cross-device consistency. For now, `sessionStorage` is sufficient.
