# Test Hardcoded/Hacky Values Audit

**Type:** Tech Debt

**Priority:** Medium

**Components:** `packages/scraper`, `apps/api`, `packages/ai-gen`, `packages/etl`

**Labels:** `tests`, `flakiness`, `test-hygiene`

## Summary

Several tests rely on wall-clock timing, real sleeps, environment-dependent paths, and (optionally) live network access. These are not currently breaking, but they increase the likelihood of flaky or non-portable test runs.

## Context

This ticket records an audit of hard-coded and "hacky" constants in the test suite, focusing on values that can cause nondeterminism (timing), external coupling (network), or portability issues (OS-specific paths).

## Findings

### Wall-Clock Timing And Real Sleeps

These tests use `setTimeout(...)` and/or `Date.now()` based assertions, which can fail on slow CI runners or under heavy load.

- [packages/scraper/src/utils/rate-limiter.test.ts](../../packages/scraper/src/utils/rate-limiter.test.ts):16-17, 21, 30-47, 55-56, 60, 71-75
- [packages/ai-gen/src/cli.test.ts](../../packages/ai-gen/src/cli.test.ts):73

Related non-deterministic "unique key" usage (not flaky by itself, but unnecessary variability):

- [packages/ai-gen/src/deepseek-client.test.ts](../../packages/ai-gen/src/deepseek-client.test.ts):208

### Intentional Never-Resolving Promise For Timeout Tests

This is a valid pattern when testing timeouts, but it can hang indefinitely if the timeout logic regresses.

- [apps/api/src/db/readiness-manager.test.ts](../../apps/api/src/db/readiness-manager.test.ts):72-82

### Optional Live Network Integration Tests

These tests reach out to a real public endpoint and create a sqlite file under `/tmp` by default when enabled via env.

- [packages/scraper/src/scrapers/live-scrape.test.ts](../../packages/scraper/src/scrapers/live-scrape.test.ts):9-12, 38, 51-56

### OS-Dependent Path Fixtures

These are currently used only for CLI parsing expectations, but they assume a Unix-like filesystem.

- [packages/etl/src/index.test.ts](../../packages/etl/src/index.test.ts):37-44

### Hard-Coded URLs And ISO Timestamps As Fixture Data

Many tests include fixed `sourceUrl` and `scrapedAt` strings. This appears to be intentional fixture data rather than brittle wiring; keep an eye out for cases where these values become coupled to parsing/formatting quirks.

## Why This Matters

- Timing-based tests tend to be flaky and slow, and can regress when concurrency/queueing logic changes.
- Optional live integration tests are useful, but they need strong isolation to avoid polluting developer machines and CI.
- OS-dependent path fixtures can block contributors on Windows or alternative CI environments.

## Proposed Remediation (Checklist)

- Replace `setTimeout(...)` sleeps in unit tests with deterministic scheduling where feasible.
- Prefer dependency injection for "time" and "sleep" in concurrency primitives (e.g., accept `now(): number` and `sleep(ms): Promise<void>` so tests can provide fakes).
- For timeout tests, avoid unbounded hangs by using a controllable promise plus explicit cleanup, or a short-circuit mechanism to guarantee completion.
- For live integration tests:
- Use `mkdtemp` or a unique per-run sqlite path even when a default is used.
- Ensure test DB cleanup runs even if a test fails early.
- For path fixtures:
- Prefer asserting parsed values relative to the provided args rather than hard-coding `/tmp/...` in expectations, or gate such assertions on `process.platform`.

## Acceptance Criteria

- No unit tests require real wall-clock waits to validate correctness of concurrency/queueing behavior.
- Timeout-related tests cannot hang indefinitely even if timeout logic breaks.
- Live integration tests (when enabled) use an isolated, per-run test DB path and reliably clean up.
- Tests do not encode OS-specific absolute paths in a way that prevents running on non-Unix environments.

## Notes

This ticket is intentionally scoped to test hygiene and determinism. It does not propose behavioral changes to production logic beyond introducing optional dependency injection seams where they improve testability.
