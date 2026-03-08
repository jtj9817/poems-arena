# AVG-READ-002 — Archive `avgReadingTime` Regression Test Plan

**Ticket Type:** Test Coverage / Regression Hardening
**Status:** Planned
**Priority:** Medium
**Assignee:** Unassigned
**Labels:** api, routes, testing, regression, avg-reading-time
**Related Ticket:** `avg-reading-time-hardcoded-archive.md`

## Context

`GET /duels` previously returned a hard-coded archive `avgReadingTime` value for every duel. That production bug is already tracked in `AVG-READ-001` and the route implementation has since been corrected to compute the value from `poemA.content` and `poemB.content`.

The remaining gap is regression coverage. Existing route tests cover pagination, topic metadata, and error handling, but they do not explicitly prove that archive `avgReadingTime` is computed from poem content on a per-row basis. The only adjacent assertion is in `GET /duels/:id/stats`, where the test currently checks only that `avgReadingTime` is a string.

Without focused archive tests, the route is exposed to regressions such as:

- reintroducing a placeholder constant
- computing a single value and reusing it across every row in the page
- drifting on whitespace handling or minute-boundary rounding
- accidentally coupling reading-time output to vote aggregation logic

## Objective

Add targeted route-level regression tests for archive `avgReadingTime` so `GET /duels` is locked to exact, content-derived values across baseline scenarios and meaningful edge cases.

## Scope

In scope:

- extend `apps/api/src/routes/duels.test.ts`
- add exact-value assertions for archive `avgReadingTime`
- cover baseline best/average/worst cases
- add edge-case coverage for per-row independence, whitespace normalization, rounding boundaries, and vote independence

Out of scope:

- changing the archive route implementation
- changing the reading-time formula
- exporting `computeAvgReadingTime` for separate helper-unit testing
- codifying empty-string behavior, which appears implementation-accidental rather than clearly intended

## Planned Approach

### 1. Add deterministic test helpers

Introduce small local helpers in the route test file:

- a word-count content generator so exact totals can be constructed without hand-counting prose
- a fixture inserter for archive-specific duel rows
- a row lookup helper for stable assertions by `duel.id`

### 2. Add baseline regression scenarios

Cover three named scenarios requested for the archive route:

1. **Best case**
   - `1 + 1` words
   - expected `avgReadingTime = "0m 1s"`

2. **Average case**
   - `100 + 100` words
   - expected `avgReadingTime = "1m 0s"`

3. **Worst case**
   - `1000 + 1000` words
   - expected `avgReadingTime = "10m 0s"`

These cases together prove the value is computed rather than fixed.

### 3. Expand with edge-case regression coverage

Add the following route tests in the same `GET /duels` block:

1. **Per-row independence**
   - seed multiple duels in the same archive response
   - assert each row has its own exact reading-time value

2. **Whitespace and newline normalization**
   - use multiline poem content with repeated spaces
   - assert normalized word-boundary behavior

3. **Rounding threshold stability**
   - cover totals around the one-minute boundary: `199`, `200`, `201`
   - assert the route preserves current rounding behavior

4. **Vote-independence**
   - seed votes for a duel
   - assert `humanWinRate` changes while `avgReadingTime` remains content-derived

## Execution Plan

1. Modify `apps/api/src/routes/duels.test.ts` only.
2. Add the deterministic helpers.
3. Add the three baseline regression tests.
4. Add the edge-case tests.
5. Run:

```bash
pnpm --filter @sanctuary/api test src/routes/duels.test.ts
```

## Acceptance Criteria

- [ ] `GET /duels` has explicit exact-value assertions for best, average, and worst reading-time scenarios.
- [ ] At least one test proves archive rows do not share a single constant reading time.
- [ ] At least one test covers multiline / repeated-whitespace poem content.
- [ ] At least one test covers rounding at the one-minute boundary.
- [ ] At least one test proves vote aggregation does not affect `avgReadingTime`.
- [ ] The targeted duels route test file passes.

## Risks / Notes

- Empty-string poem content is intentionally excluded from this ticket because the current splitter logic appears to count accidental tokens for blank input. Adding that case would freeze likely-unintended behavior.
- This ticket is intentionally narrow. It strengthens regression coverage without broadening into helper refactors or route changes.
