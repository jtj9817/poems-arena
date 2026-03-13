# UA-TEST-001: Votes Router Tests Hygiene (Analytics Phase 2)

**Type:** Tech Debt

**Priority:** Low

**Components:** `apps/api`

**Labels:** `tests`, `test-hygiene`, `analytics`

## Summary

The `POST /votes` route tests added for Phase 2 are logically correct and currently passing, but a few small test-harness and assertion patterns are somewhat “hacky” (resource lifecycle + SQLite behavior) or rely on arbitrary constants. Tightening these improves determinism and reduces drift risk.

## Context

- Router under test: `POST /api/v1/votes` (votes router factory + aggregate updates).
- Test file: [apps/api/src/routes/votes.test.ts](../../apps/api/src/routes/votes.test.ts)

## Findings

### 1) In-memory DB teardown is intentionally skipped

The tests avoid closing the LibSQL client for `file::memory:` due to an observed `@libsql/client` behavior, relying on GC cleanup instead.

- Risk: can leak resources / cause odd cross-test interactions if the suite grows and tests run long-lived.

### 2) Handwritten DDL can drift from the real schema

The test suite creates tables via a raw `ddl` array, duplicating schema definitions that also exist in Drizzle migrations/schema.

- Risk: schema changes can land without test DDL being updated, producing false confidence.

### 3) SQLite foreign keys likely not enforced in tests

SQLite requires `PRAGMA foreign_keys = ON;` per connection for FK enforcement. The test DB setup does not enable it.

- Risk: FK regressions won’t be caught by this test suite even though `REFERENCES ...` exist in DDL.

### 4) A couple of “magic” constants reduce intent clarity

- `oversized = TEN_MINUTES_MS + 99999` is arbitrary; `TEN_MINUTES_MS + 1` or `TEN_MINUTES_MS * 2` communicates intent more directly.
- Several `readingTimeMs` fixture values (e.g., `30000`, `45000`) are fine as fixtures, but could be named (`THIRTY_SECONDS_MS`, etc.) for readability if this file keeps growing.

### 5) A couple tests assert only DB state, not response status

Two cases are verifying the right side-effect behavior, but do not assert the route response code:

- “invalid vote (readingTimeMs <= 0) does not update aggregates” should assert `400`.
- “clamped readingTimeMs contributes…” should assert `200`.

## Proposed Remediation (Checklist)

- Add `PRAGMA foreign_keys = ON;` in `createTestDb()` after creating the client (or before DDL).
- Replace `TEN_MINUTES_MS + 99999` with a less arbitrary oversized value.
- Add missing `res.status` expectations where tests currently rely only on DB assertions.
- Consider extracting common ms fixtures into named constants if more timing-oriented cases are added.
- If feasible, revisit client teardown so tests can close connections without triggering the `file::memory:`/transaction issue (or switch to a per-test temp sqlite file path).

## Acceptance Criteria

- `votes.test.ts` asserts both response status and intended DB side-effects for validation/clamping cases.
- FK enforcement is enabled in the in-memory DB connection used by tests.
- Oversized/clamping tests do not use arbitrary values that obscure intent.
- Test DDL remains representative of production schema (either via updates or a safer pattern).

