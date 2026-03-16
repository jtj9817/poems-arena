# AVG-READ-003 — Archive `avgReadingTime` Regression Test Execution

**Ticket Type:** Test Implementation / Execution Record
**Status:** Superseded
**Priority:** Medium
**Assignee:** Unassigned
**Labels:** api, routes, testing, regression, avg-reading-time
**Related Tickets:** `avg-reading-time-hardcoded-archive.md`, `avg-reading-time-archive-regression-plan.md`

> **Note (2026-03-16):** The tests implemented here targeted `avgReadingTime`, which has since been
> removed from the API as part of the User Analytics track (shipped 2026-03-13). The archive route
> now returns `avgDecisionTimeMs` / `avgDecisionTime` instead. The `duels.test.ts` test suite
> covers those fields. This ticket is retained for historical context.

## Context

`AVG-READ-001` documented the original production bug where `GET /duels` returned a hard-coded archive `avgReadingTime`. The route implementation has already been corrected, but the archive route still lacked exact regression assertions proving the value is derived from the paired poem content.

`AVG-READ-002` captured the approved implementation plan for closing that test gap. This ticket records the actual code-file modifications made to execute that plan.

## What Was Done

Updated `apps/api/src/routes/duels.test.ts` to add focused archive-route regression coverage for `avgReadingTime`.

### Test helpers added

- `ArchiveDuelRow` response shape helper
- `makeWordContent(count, prefix)` deterministic content generator
- `insertArchiveDuelFixture(...)` archive-specific seed helper
- `getArchiveDuel(rows, duelId)` response lookup helper

### Baseline regression scenarios added

1. **Best case**
   - `1 + 1` words
   - expected `0m 1s`

2. **Average case**
   - `100 + 100` words
   - expected `1m 0s`

3. **Worst case**
   - `1000 + 1000` words
   - expected `10m 0s`

### Edge-case scenarios added

1. **Per-row independence**
   - multiple archive duels in the same response
   - asserts each row gets a different computed value

2. **Whitespace and newline normalization**
   - multiline content with repeated spaces
   - asserts normalized word-boundary counting

3. **Rounding threshold stability**
   - `199`, `200`, `201` total words
   - asserts current `Math.round` behavior remains stable at the one-minute boundary

4. **Vote-independence**
   - seeded votes for one duel
   - asserts `humanWinRate` updates without affecting `avgReadingTime`

## Code Files Modified

| File | Change |
|---|---|
| `apps/api/src/routes/duels.test.ts` | Added deterministic archive regression helpers and seven exact-value `GET /duels` reading-time tests |

## Validation

Executed:

```bash
pnpm --filter @sanctuary/api test src/routes/duels.test.ts
```

Result:

- pass
- `35 pass`
- `0 fail`

## Acceptance Criteria Status

- [x] `GET /duels` now has exact-value assertions for best, average, and worst archive reading-time scenarios.
- [x] The test suite now proves archive rows do not share a single constant reading time.
- [x] The test suite covers multiline / repeated-whitespace poem content.
- [x] The test suite covers one-minute rounding thresholds.
- [x] The test suite proves vote aggregation does not affect archive `avgReadingTime`.
- [x] Targeted route tests pass.

## Notes

- Empty-string content was intentionally left out of regression coverage because the current splitter behavior for blank input appears accidental rather than a clearly intended contract.
- This execution stayed scoped to tests only. No route implementation changes were needed.
