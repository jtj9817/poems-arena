# [TASK] Improve LOC 180 Scraper — Rate Limit Handling

**Date:** 2026-03-01
**Status:** Open
**Priority:** Medium
**Assignee:** —
**Labels:** `scraper`, `loc-180`, `rate-limiting`
**Parent:** [`etl-pipeline-activation.md`](etl-pipeline-activation.md)

## Context

During the Phase 1 scrape run (2026-03-01), the LOC Poetry 180 scraper retrieved only **65 of ~180 poems**. The remaining ~115 poem pages returned HTTP 429 (Too Many Requests) from LOC's servers.

The scraper already uses `createRateLimiter` from `packages/scraper/src/utils/rate-limiter.ts`, configured at:

```typescript
// packages/scraper/src/scrapers/loc-180.ts
const limit = createRateLimiter({ concurrency: 5, minDelay: 200 });
```

With 5 concurrent slots and 200ms minimum delay between requests, the effective throughput was too high for LOC's rate limit threshold. All 180 poem URLs were dispatched concurrently into `Promise.all(poemPromises)`, so even with the semaphore, bursts of requests fired faster than LOC permits.

## Goal

Re-scrape LOC Poetry 180 and retrieve all ~180 poems successfully. The fix should be robust enough that a re-run completes without significant 429 failures.

## Required Changes

**File:** `packages/scraper/src/scrapers/loc-180.ts`

### 1. Reduce concurrency and increase delay

Lower the rate limiter settings to stay well within LOC's threshold:

```typescript
const limit = createRateLimiter({ concurrency: 1, minDelay: 1000 });
```

Start with sequential requests (`concurrency: 1`) at 1 second apart. This gives ~3 poems/minute — ~60 minutes for 180 poems, which is acceptable for a one-time batch scrape.

If timing needs to be tuned, `concurrency: 2, minDelay: 800` is a reasonable middle ground to try.

### 2. Add retry with backoff on 429

The current code logs and skips on 429. Instead, retry with exponential backoff:

```typescript
// On 429 response: wait for Retry-After header value (or fallback to 5s), then retry.
// Cap at 3 retries per URL before skipping.
```

The LOC response includes `Retry-After` or a suggested retry delay in the error body. Use it if present, otherwise default to 5 seconds.

### 3. Validate final count

After re-scrape, confirm the output file contains ≥170 poems (allowing for a small number of genuinely unavailable pages).

## Re-Scrape Command

After implementing the fix:

```bash
# Re-scrape LOC only (leaves existing gutenberg and poets-org files intact)
bun scripts/run-scrape.ts --sources loc-180
```

Then re-run the ETL pipeline to incorporate the additional poems:

```bash
pnpm --filter @sanctuary/etl run pipeline --include-non-pd
```

> **Note:** The ETL load stage uses `INSERT OR IGNORE` with deterministic SHA-256 IDs, so re-running after adding LOC poems is safe and idempotent.

## Acceptance Criteria

- [ ] LOC scrape retrieves ≥ 170 of 180 poems with no more than a handful of 429 failures
- [ ] Re-scrape completes without needing manual intervention
- [ ] ETL re-run after re-scrape increases HUMAN poem count in the DB
- [ ] Rate limiter settings are documented in a comment in `loc-180.ts`
