# [TASK] Improve LOC 180 Scraper — Rate Limit Handling

**Date:** 2026-03-01
**Status:** Superseded
**Priority:** Medium
**Assignee:** —
**Labels:** `scraper`, `loc-180`, `rate-limiting`
**Parent:** [`etl-pipeline-activation.md`](etl-pipeline-activation.md)

## Verification Update (2026-03-08)

This ticket no longer matches the current implementation.

- The LOC scraper no longer uses the queue/concurrency design described here.
- Current code uses the LOC JSON API, sequential poem fetches, retry loops, and a fetch-first transport with Playwright fallbacks.
- The relevant follow-up work is tracked more accurately in `loc-scraper-waf-bypass.md` and `scraper-loc-180-refinement.md`.

Keep this ticket for historical context only; do not treat it as the active implementation plan.

## Context

During the Phase 1 scrape run (2026-03-01), the LOC Poetry 180 scraper retrieved only **65 of ~180 poems**. The remaining ~115 poem pages returned HTTP 429 (Too Many Requests) from LOC's servers.

The scraper currently uses a basic queue-based rate limiter, which is insufficient for handling dynamic WAF rate limits or burst blocks. Instead of attempting to perfectly predict the rate limit with a sliding window, we need a reactive strategy that gracefully handles 429s using backoff and a global circuit breaker.

## Goal

Re-scrape LOC Poetry 180 and retrieve all ~180 poems successfully. Implement a robust backoff strategy with a global circuit breaker to handle rate limits gracefully without dropping items.

## Required Changes

### 1. Baseline Pacing (The Governor)
**File:** `packages/scraper/src/scrapers/loc-180.ts`
Lower the baseline concurrency and increase delay to establish a conservative baseline.
```typescript
const limit = createRateLimiter({ concurrency: 2, minDelay: 1000 });
```

### 2. Robust Fetch Wrapper with Backoff (The Retry Loop)
**File:** `packages/scraper/src/scrapers/loc-180.ts` (or a new utility function)
Wrap the HTTP fetch call in a retry loop:
*   **Success (200-299):** Proceed.
*   **Terminal Errors (403, 404, 410):** Do not retry. Log and skip.
*   **Rate Limited (429) & Server Errors (5xx):**
    *   Max retries: 4.
    *   Extract `Retry-After` header if available.
    *   Fallback to Exponential Backoff with Jitter: `delay = baseDelay * (2 ^ attempt) * jitter(0.8 - 1.2)`.

### 3. Global Failure Circuit Breaker
When one concurrent request receives a 429, others are likely to fail too. A global circuit breaker ensures we pause all outbound traffic when a block is detected.
*   Implement a global module-level state variable `let globalPauseUntil = 0;`.
*   When a 429 occurs, update `globalPauseUntil = Date.now() + backoffDelay`.
*   Before any request executes, check if `Date.now() < globalPauseUntil`. If so, await a timeout until `globalPauseUntil`.

*(Note on Architecture: Because Bun executes async/await `Promise.all` tasks concurrently on a single event-loop thread, a simple module-level variable acts as a perfect thread-safe lock for our circuit breaker. Using Bun Workers would introduce multi-threading and require SharedArrayBuffer or message passing, which is unnecessary overhead for an IO-bound batch of 180 requests).*

### 4. Post-Scrape Validation
Validate that the final array of successfully scraped poems is `>= 170`. Throw a hard error or exit if the threshold isn't met to prevent bad data from moving down the ETL pipeline.

## Re-Scrape Command

After implementing the fix:

```bash
# Re-scrape LOC only (leaves existing files intact)
bun scripts/run-scrape.ts --sources loc-180
```

Then re-run the ETL pipeline to incorporate the additional poems:

```bash
pnpm --filter @sanctuary/etl run pipeline --include-non-pd
```

## Acceptance Criteria

- [ ] Baseline rate limiter is dialed down to conservative levels.
- [ ] Retries are handled with `Retry-After` parsing and exponential backoff + jitter.
- [ ] A Global Circuit Breaker halts all concurrent requests when a 429 is hit.
- [ ] LOC scrape retrieves ≥ 170 of 180 poems.
- [ ] ETL re-run after re-scrape successfully increases HUMAN poem count in the DB.
