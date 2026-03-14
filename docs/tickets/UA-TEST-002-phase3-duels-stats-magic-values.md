# UA-TEST-002: Phase 3 Duels Stats Magic Values (avgDecisionTime)

**Type:** Tech Debt

**Status:** Closed

**Priority:** Low

**Components:** `apps/api`, `scripts`

**Labels:** `tests`, `test-hygiene`, `analytics`, `manual-verification`

## Summary

The Phase 3 duels stats test coverage (and its manual verification harness) uses several
hard-coded fixture numbers and strings. These values are deterministic and the tests are
correct, but the literals reduce readability and increase drift risk when the underlying
rounding/format rules evolve.

## Context

- Commit: `782374e` (`fix(analytics): finalize phase3 verdict stats`)
- Areas:
  - `GET /duels/:id/stats` route test coverage
  - Phase 3 manual verification script assertions

## Findings

### 1) Magic fixture math values in `duels.test.ts`

File: [apps/api/src/routes/duels.test.ts](../../apps/api/src/routes/duels.test.ts)

- Uses literal vote totals/rates and ms sums/counts that only make sense with inline comments.
  - Example expectations around:
    - `avgDecisionTimeMs: 30000` with comment `300000 / 10`
    - `decisionTimeSumMs: 504000` + `decisionTimeCount: 2` => expect `252000` and `'4m 12s'`
    - Regression case: `decisionTimeSumMs: 480000` + `decisionTimeCount: 4` => expect `120000`
      and `'2m 00s'` (exact-minute formatting)

These are valid fixtures, but they read like “magic numbers” unless you re-derive the math.

### 2) Hard-coded IDs/labels and expected values in Phase 3 verification harness

File: [scripts/verify-phase3-user-analytics.ts](../../scripts/verify-phase3-user-analytics.ts)

- Hard-coded entity IDs/labels:
  - `'duel-001'`, `'topic-nature'`, `'Nature'`, `'global'`, `'poem-human-1'`, `'poem-ai-1'`
- Hard-coded aggregate fixtures and expected outputs:
  - Global: `totalVotes: 12`, `humanVotes: 9`, `decisionTimeSumMs: 1_440_000`,
    `decisionTimeCount: 12` => expected `avgDecisionTimeMs: 120000`, `'2m 00s'`
  - Topic: `totalVotes: 8`, `humanVotes: 6`, `decisionTimeSumMs: 480_000`,
    `decisionTimeCount: 8` => expected `avgDecisionTimeMs: 60000`, `'1m 00s'`
- “Magic tail sizes” for log truncation:
  - `slice(-800)`, `slice(-500)`, `slice(-1200)`, `slice(-1000)`

Again, all deterministic and fine for a manual gate script, but naming these would make the
intent clearer and reduce copy/paste arithmetic mistakes.

## Proposed Remediation (Checklist)

- Extract intent-revealing constants for ms math fixtures (examples):
  - `const MS_PER_SECOND = 1000; const MS_PER_MINUTE = 60 * MS_PER_SECOND;`
  - `const TWO_MINUTES_MS = 2 * MS_PER_MINUTE;`
  - Prefer derived values (`2 * MS_PER_MINUTE`) over bare literals (`120000`).
- In `verify-phase3-user-analytics.ts`, define stable IDs/labels once (top-level `const`) and
  reuse them in inserts and assertions.
- Replace log truncation literals with named constants (e.g. `STDOUT_TAIL_CHARS`,
  `STDERR_TAIL_CHARS`) to reduce arbitrary duplication.

## Acceptance Criteria

- [x] Phase 3 duels stats tests and verification harness do not rely on unexplained numeric literals where a derived or named constant would make intent clearer.
- [x] No behavioral changes to production logic are required to complete this cleanup.

---

## Resolution

**Closed:** 2026-03-14

All findings verified as resolved:

1. **`duels.test.ts` magic ms values** — Named constants defined at the top of the test file: `MS_PER_SECOND`, `MS_PER_MINUTE`, `THIRTY_SECONDS_MS`, `TWO_MINUTES_MS`, `FOUR_MINUTES_TWELVE_SECONDS_MS`, `FIVE_MINUTES_MS`, `TWO_AND_HALF_MINUTES_MS`. Fixture inserts and expectations use derived values (e.g. `TWO_MINUTES_MS * 4`).
2. **`verify-phase3-user-analytics.ts` hard-coded IDs/labels** — Named constants defined: `GLOBAL_STATS_ID`, `TOPIC_ID_NATURE`, `POEM_HUMAN_ID`, `POEM_AI_ID`, `DUEL_ID`, plus ms constants. Log truncation literals replaced with `STDERR_TAIL_CHARS`, `DB_PUSH_STDOUT_TAIL_CHARS`, `ROUTE_CHECK_STDOUT_TAIL_CHARS`, `TEST_STDOUT_TAIL_CHARS`.

