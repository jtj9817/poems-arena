# [TASK] LOC 180 Scraper WAF Bypass Algorithm Redesign

**Date:** 2026-03-02
**Status:** Open
**Priority:** High
**Assignee:** —
**Labels:** `scraper`, `etl`, `loc-180`, `waf`

**Linked To:** 
- Parent Ticket: [`etl-pipeline-activation.md`](etl-pipeline-activation.md)
- Related: [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md)

## Context

According to the status update in the `etl-pipeline-activation.md` ticket, the Phase 1 LOC scrape is still incomplete. The Library of Congress (LOC) Web Application Firewall (WAF) is still able to detect our scraping attempts as a flagrant violation of its rules. This results in a long-duration IP ban after approximately 52 requests, despite previous rate-limiting efforts (`minDelay: 4000`).

The WAF is likely detecting either:
1. The lack of typical browser headers (e.g., node fetch user-agent).
2. The robotic predictability of the requests (static delay).
3. A strict rate limit per IP over a short time window (e.g., max 50 requests/hour).

Therefore, the scraping algorithm in `packages/scraper/src/scrapers/loc-180.ts` must be reworked to simulate human behavior and successfully bypass the WAF.

## Proposed Solution / Implementation Plan

### 1. Spoof Realistic Browser Headers (High Impact)
Currently, `fetchImpl(url)` is called without HTTP headers, exposing the default node environment user-agent.
**Action:** Pass standard browser headers in every `fetch` call to disguise the scraper as a regular user navigating the site.

```typescript
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1'
};
```

### 2. Introduce "Human-Like" Jitter
A strict `minDelay: 4000` is highly predictable.
**Action:** Apply a randomized delay between every single request (e.g., 4 to 9 seconds) rather than a static limiter delay.

```typescript
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const randomJitter = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);
// Example usage: await delay(randomJitter(4000, 9000));
```

### 3. Implement Micro-Batching with Macro-Pauses
If the WAF strictly limits an IP to ~50 requests per window, we must respect that quota by grouping requests and taking long "reading" breaks.
**Action:** Process poems in batches of 20–30 (e.g., 25). After a batch finishes, enforce a 5 to 10-minute pause before starting the next batch.

### 4. Sequential Execution instead of Promise.all
The current `p-limit` implementation queues all 180 promises at once using `Promise.all(poemPromises)`.
**Action:** Refactor the link processing into a clean `for...of` loop to better manage state, macro-pauses, and early aborts.

```typescript
const poems: ScrapedPoem[] = [];

for (let i = 0; i < poemLinks.length; i++) {
    const link = poemLinks[i];
    
    // Process poem sequentially
    const poem = await processPoem(link); 
    if (poem) poems.push(poem);
    
    // Check for macro-pause every 25 poems
    if ((i + 1) % 25 === 0 && i !== poemLinks.length - 1) {
        logger.info('Taking a 6-minute break to reset WAF thresholds...');
        await delay(6 * 60 * 1000); 
    } else {
        // Standard random jitter between poems
        await delay(randomJitter(4000, 9000));
    }
}
```

## Acceptance Criteria
- [ ] `loc-180.ts` is updated to include standard browser headers on all fetch requests.
- [ ] A random jitter delay is implemented between sequential requests.
- [ ] Macro-pauses (e.g., 6 minutes after every 25 requests) are implemented.
- [ ] The `Promise.all` concurrency model is replaced with a sequential `for...of` loop for the poem processing phase.
- [ ] The scraper successfully runs against LOC 180 without triggering an IP ban.
