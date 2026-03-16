# AVG-READ-001 — `avgReadingTime` Hard-Coded in `GET /duels` Archive Endpoint

**Component:** `apps/api/src/routes/duels.ts`
**Status:** Superseded
**Severity:** Low
**Type:** Bug / Data Integrity

> **Note (2026-03-16):** This bug and the entire `avgReadingTime` field have been superseded by the
> User Analytics track (shipped 2026-03-13), which replaced word-count reading-time estimates with
> behavioral `avgDecisionTime` analytics backed by the `topic_statistics` aggregate table.
> `avgReadingTime` no longer exists in the API response. This ticket is retained for historical context.

---

## Summary

The paginated duel archive endpoint (`GET /duels`) returns a hard-coded `avgReadingTime` value of `"3m 30s"` for every duel in the result set, regardless of actual poem content length. The correct computation — `computeAvgReadingTime(poemA.content, poemB.content)` — already exists in the codebase and is correctly applied in `GET /duels/:id/stats`, but was never wired into the archive query.

---

## Reproduction

```
GET /api/v1/duels?page=1
```

Every item in the response array will have `"avgReadingTime": "3m 30s"` irrespective of the actual word counts of the paired poems.

---

## Root Cause

The archive query (`GET /duels`, `duels.ts:18–31`) selects only duel metadata and performs a single secondary query for vote stats. Poem content is never fetched. When constructing the response (line 55–66), `avgReadingTime` was placeholder-filled with the literal string `'3m 30s'` and never replaced with computed output.

```typescript
// duels.ts:62–65 — current (broken)
humanWinRate:
  stats.totalVotes > 0 ? Math.round((stats.humanVotes / stats.totalVotes) * 100) : 0,
avgReadingTime: '3m 30s',  // ← hard-coded
```

The `computeAvgReadingTime` function (lines 301–307) is already defined in the same file and is O(n) over the combined word count of two poem strings. It is used correctly in `GET /duels/:id/stats` (line 180).

---

## Expected Behaviour

`avgReadingTime` in the archive response must reflect the actual word count of `poemA.content + poemB.content` for each duel, computed at ~200 wpm, consistent with `GET /duels/:id/stats`.

---

## Fix Approach

The archive query must be extended with a secondary poem content fetch, parallel to the existing vote stats fetch:

1. Add `poemAId` and `poemBId` to the `SELECT` in the main archive query.
2. Collect all unique poem IDs across the result page.
3. Issue a secondary `db.select({ id, content }).from(poems).where(inArray(poems.id, poemIds))` query.
4. Build a `Map<poemId, content>` lookup.
5. Replace the hard-coded string with `computeAvgReadingTime(contentA, contentB)` per duel.

This mirrors the existing pattern for vote stats and adds one additional DB round-trip per page request (fetching content for up to 24 poems — 12 duels × 2 poems). No schema changes required.

---

## Affected Surface

| Location | Line(s) | Notes |
|---|---|---|
| `apps/api/src/routes/duels.ts` | 18–31 | Archive SELECT — missing `poemAId`, `poemBId` |
| `apps/api/src/routes/duels.ts` | 64 | Hard-coded `'3m 30s'` |
| `apps/api/src/routes/duels.test.ts` | Archive test assertions | Tests should assert computed values, not the literal string |

---

## Out of Scope

- Caching computed reading times in the DB
- Changing the `computeAvgReadingTime` formula
- Any changes to `GET /duels/:id/stats` (already correct)
