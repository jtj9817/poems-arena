# UA-TEST-003: Phase 5 Regression Assertions Brittleness (Magic Values / Seed Coupling)

**Type:** Tech Debt

**Priority:** Low

**Components:** `apps/api`, `apps/web`, `scripts`

**Labels:** `tests`, `test-hygiene`, `analytics`, `manual-verification`

## Summary

The Phase 5 regression assertions added for user analytics are logically correct and currently
passing, but a couple cases rely on brittle, hard-coded values (seed IDs and exact UI strings).
This is acceptable as a short-term regression guard, but it increases drift risk when fixtures,
copy, or reporters change without any underlying behavioral regression.

## Context

- Commit(s):
  - `f031041` (`test(analytics): add Phase 5 regression assertions`)
  - `3229775` (`test(analytics): add Phase 5 verification script with assertion coverage map`)
- Areas:
  - API tests: [apps/api/src/routes/duels.test.ts](../../apps/api/src/routes/duels.test.ts)
  - Web tests: [apps/web/components/VerdictPopup.test.tsx](../../apps/web/components/VerdictPopup.test.tsx)
  - Manual verification harness: [scripts/verify-phase5-user-analytics.ts](../../scripts/verify-phase5-user-analytics.ts)

## Findings

### 1) API assertion uses a hard-coded duel ID literal

File: [apps/api/src/routes/duels.test.ts](../../apps/api/src/routes/duels.test.ts)

- Test: `archive rows include avgDecisionTime fields and exclude avgReadingTime`
- Uses `body.find((r) => r.id === 'duel-001')` (literal)

Risk:
- This couples the test to a specific seeded ID and makes it easy to drift if shared fixtures are
  renamed. The suite already defines `DUEL_1`, so the test should reuse `DUEL_1.id` (or create its
  own duel fixture and assert against it).

### 2) Web assertions depend on exact UI copy/glyphs and unscoped fallbacks

File: [apps/web/components/VerdictPopup.test.tsx](../../apps/web/components/VerdictPopup.test.tsx)

- Exact-string assertion for delta indicator: `↓ 15% vs global`
- Fallback assertion checks `html` contains `—` without scoping to timing elements

Risk:
- Minor copy changes (e.g. wording, spacing, or symbol choice) will fail tests while behavior
  remains correct.
- The `—` assertion could become a false-positive if the glyph appears elsewhere in the markup.

### 3) Phase 5 verification script parses human-readable test output

File: [scripts/verify-phase5-user-analytics.ts](../../scripts/verify-phase5-user-analytics.ts)

- API gate: regex `/(\\d+)\\s+pass/` and `/(\\d+)\\s+fail/`
- Web gate: `includes('passed')`

Risk:
- Output parsing is reporter-dependent. If the reporter format changes (while exit codes remain
  accurate), the manual gate can break for non-behavioral reasons.

## Proposed Remediation (Checklist)

- API: Replace `'duel-001'` literal with `DUEL_1.id` (or insert a dedicated duel fixture inside
  the test and assert against it).
- Web: Derive expected delta string from fixture inputs (avoid hard-coded `15`) and tighten the
  `—` fallback assertion to reduce false positives (e.g. assert expected count or scope by
  element IDs).
- Scripts: Prefer exit-code based gating for API/web suites; if output checks are desired, avoid
  brittle reporter-dependent substrings.

## Acceptance Criteria

- Phase 5 regression assertions do not rely on unexplained/duplicated literals where existing
  shared fixtures or derived expectations provide the same coverage with less brittleness.
- Manual verification script does not fail solely due to changes in test reporter output when the
  command exit codes indicate success.
- No production/runtime behavior changes are required.

