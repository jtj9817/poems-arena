# SCRAPER-LOC-180-REFINEMENT

**Status:** OPEN  
**Priority:** Medium  
**Created:** 2026-03-02  
**Related Track:** `packages/scraper`

---

## Summary

Refine `packages/scraper/src/scrapers/loc-180.ts` to simplify the fetch/pacing algorithm, reduce Playwright overhead for JSON requests, and improve partial-result robustness, without changing the shape or meaning of the scraped poems.

## Problem

Current implementation is correct but can be made simpler and more robust:

- **Playwright is used as the primary transport for JSON** (`page.goto(...?fo=json)` per request). This is heavier than needed and opens/closes a new page per URL. See `getBody()` around `loc-180.ts:111-154`.
- **Pacing is implemented as a stepwise loop with large default delays** (4-9s jitter per poem, plus 5-10 min macro pause every 25 poems). This is explicit and test-covered, but the logic is more complex than necessary and makes “safe but faster” tuning hard. See `loc-180.ts:10-18` and `loc-180.ts:290-311`.
- **Post-scrape validation throws**, which is caught by the outer `try/catch` and results in returning `[]`, discarding already-scraped poems. See `loc-180.ts:314-330`.
- **Deduping is by URL string**, not by poem number. If LOC returns multiple URLs for the same poem number (different slugs, trailing slash variants, query params), we can end up with duplicates or missing deterministic selection. See `loc-180.ts:204-219`.
- **WAF detection is URL-based only** (checks `finalUrl` for substrings). If a challenge page returns with a normal-looking URL or HTML content type, we may misclassify it as “OK” and then fail JSON parsing later, increasing retries/noise. See `loc-180.ts:124-147` and JSON parsing around `loc-180.ts:245-285`.

## Suggested Refinements (No Fundamental Output Change)

### Output Invariants (Must Remain True)

- `ScrapedPoem.source` remains `'loc-180'`.
- `ScrapedPoem.sourceUrl` remains the poem detail page URL (the one that contains `poetry-180-XYZ`), not the `?fo=json` URL.
- `sourceId` generation remains `generateSourceId('loc-180', url, title)` using the poem detail page URL and final extracted title.
- Poem `content` continues to be extracted from the `<pre>` within `item.article` and continues to exclude attribution lines outside the `<pre>`.
- `isPublicDomain` remains `false`.

1. **Use `fetch` (or Playwright `APIRequestContext`) as the default for LOC JSON**, and keep Playwright page navigation only as a fallback when a WAF/challenge is detected.
   - This aligns with other scrapers (e.g. `gutenberg.ts`, `poets-org.ts`) that default to `fetch`.
   - For Playwright-based fallback, prefer `context.request.get(url)` to avoid opening a new page per request.

2. **Return partial results on post-scrape validation failure.**
   - Replace the `throw` at `loc-180.ts:315-318` with a `logger.error(...)` (include `poems.length`, expected count, and maybe `start/end`) and still return `poems`.
   - Preferred behavior: default to returning partial results (do not discard already-scraped poems).
   - If strict behavior is still needed for some callers, introduce an option like `strictValidation?: boolean` with a clear default (`false`), and when enabled preserve current “fail-hard” behavior.

3. **Simplify link collection and dedupe by poem number.**
   - Build a `Map<number, string>` from the search results (first seen wins, or prefer canonical URL if detectable), then sort numbers.
   - This removes `seenUrls` and makes “exactly one URL per poem number” an explicit invariant.

4. **Make pacing configurable and unify it under a single mechanism.**
   - Add options for `requestJitterMs`, `macroPauseEvery`, `macroPauseMs`, or a `pacingProfile` object while preserving the current defaults (tests should remain valid).
   - Consider using `createRateLimiter({ concurrency: 1, minDelay: X })` for the baseline delay, with explicit macro pauses layered on top, or implement a single `await pace(processedCount)` function.

5. **Improve “expected JSON” detection for LOC endpoints.**
   - If response `Content-Type` is `text/html` (or body starts with `<`), treat as a WAF/challenge and retry with backoff/fallback transport.
   - This reduces noisy JSON parse warnings and avoids retrying a path that will never succeed.

### Transport Preference (Implementation Guidance)

- Preferred order:
  1. Bun `fetch` for `SEARCH_URL` and each poem `?fo=json` request.
  2. Playwright `context.request.get(url)` if (and only if) `fetch` appears blocked or returns HTML/challenge.
  3. Full page navigation (`page.goto`) only as a last resort for challenge detection/debugging, since it is the most expensive path.

## Files Affected

- `packages/scraper/src/scrapers/loc-180.ts`
- `packages/scraper/src/scrapers/loc-180.test.ts` (only if new options / behavior switches are added)

## How To Verify

- Unit tests: `pnpm --filter @sanctuary/scraper test` (must keep `loc-180.test.ts` passing; it locks in default pacing expectations).
- Optional smoke run: `packages/scraper/src/scrapers/live-scrape.test.ts` (if enabled/used in your workflow) to confirm behavior against real LOC endpoints.

## Acceptance Criteria

- [ ] Successful scrapes produce the same `ScrapedPoem` fields as today for the same inputs.
- [ ] LOC fetch path does not require opening a new Playwright page per JSON request.
- [ ] When post-scrape validation fails, already-scraped poems are still returned (and the failure is clearly logged).
- [ ] Dedupe is deterministic and keyed by poem number, not URL string.
- [ ] Pacing defaults remain unchanged (existing tests continue to pass), but pacing can be overridden via options for faster controlled runs.
