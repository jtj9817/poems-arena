# [TASK] LOC 180 Scraper WAF Bypass — Revised Plan

**Date:** 2026-03-02
**Status:** Open
**Priority:** High
**Assignee:** —
**Labels:** `scraper`, `etl`, `loc-180`, `waf`, `playwright`

**Linked To:**
- Parent Ticket: [`etl-pipeline-activation.md`](etl-pipeline-activation.md)
- Related: [`loc-scraper-rate-limit.md`](loc-scraper-rate-limit.md)

---

## What Was Tried (and Failed)

The original bypass plan proposed in this ticket was implemented in full (commit `6e8d1b3`):

- ✅ Browser-like headers (`User-Agent`, `Accept`, `Sec-Fetch-*`, etc.)
- ✅ Random per-request jitter (4–9 s)
- ✅ Micro-batch macro-pauses (5–10 min every 25 poems)
- ✅ Sequential `for...of` loop (no `Promise.all`)
- ✅ Circuit breaker with 90 s minimum block on any 429
- ✅ `Retry-After` header parsing

Despite all of this, three re-scrape attempts on 2026-03-02 all failed. Attempt 1 got ~52 poems then was blocked; attempts 2 and 3 were blocked on the very first list-page request.

---

## Revised Diagnosis

The original plan assumed the WAF was reacting to **request rate and missing headers**. This was incorrect.

The key observation: **the user can load the same LOC pages in a browser on the same machine from the same IP without any issues.** This rules out a true IP-level ban. The WAF is performing **client fingerprinting**, distinguishing our process from a real browser even though the IP is identical.

The most likely detection vectors, in order of probability:

1. **TLS fingerprint mismatch** — Bun's TLS ClientHello presents a different cipher suite ordering and extension list than Chrome's. Sophisticated WAFs (Akamai Bot Manager, Cloudflare Bot Management) fingerprint TLS at the handshake level, before any HTTP headers are visible. Header spoofing cannot fix this.

2. **No cookie persistence** — WAFs commonly issue a cookie challenge on first contact (a `Set-Cookie` with a short-lived clearance token). Browsers handle this transparently; `fetch` does not carry cookies across calls, so every request looks like a fresh unverified client.

3. **Missing Client Hints** — Chrome 89+ sends `Sec-CH-UA`, `Sec-CH-UA-Mobile`, and `Sec-CH-UA-Platform`. Their absence is a strong bot signal on Chromium-based WAF fingerprinting rules.

**Conclusion:** Header spoofing alone cannot defeat TLS-level fingerprinting. The only reliable fix is to scrape with a real browser process — or to avoid scraping entirely by using an official API if one exists.

---

## Implementation Plan

### Phase 0 — Check for LOC JSON API (Do This First)

LOC exposes a `?fo=json` query parameter on many of its pages that returns structured JSON instead of HTML. If the Poetry 180 collection is available via this API, scraping becomes unnecessary.

**Manual check (takes ~2 minutes):**

```bash
# Check if the all-poems list page returns JSON
curl -s "https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/?fo=json" \
  | head -c 500

# Also check individual poem page
curl -s "https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/poem-number-1/?fo=json" \
  | head -c 500
```

**If the API works:** Update `loc-180.ts` to hit the JSON endpoint instead of parsing HTML. The `scrapeLoc180()` public interface stays the same; only the internals change. Close this ticket and open a new `loc-scraper-json-api.md` with the implementation details.

**If the API returns HTML, 404, or 403:** Proceed to Phase 1.

---

### Phase 1 — Playwright-Based Scraper

Replace the `fetch`-based scraping loop with a headless Chromium browser driven by Playwright. A real browser process handles TLS fingerprinting, cookie challenges, and Client Hints automatically.

#### 1.1 — Add `playwright` to `@sanctuary/scraper`

```bash
pnpm --filter @sanctuary/scraper add playwright
```

After install, download the Chromium binary:

```bash
pnpm --filter @sanctuary/scraper exec playwright install chromium
```

**Note:** `playwright` (the core library) is used here rather than `@playwright/test`. The test runner is not needed; only `chromium.launch()` is required.

#### 1.2 — Rewrite `scrapeLoc180` internals

The public function signature stays identical:

```typescript
export async function scrapeLoc180(
  start: number = 1,
  end: number = 180,
  options: Loc180ScraperOptions = {},
): Promise<ScrapedPoem[]>
```

Replace the `fetchImpl` loop with a Playwright browser session:

```typescript
import { chromium } from 'playwright';

// Inside scrapeLoc180():
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...',
  locale: 'en-US',
  // context shares cookies across all pages — handles WAF cookie challenges
});

try {
  // 1. Navigate the list page to seed cookies
  const listPage = await context.newPage();
  await listPage.goto(LIST_URL, { waitUntil: 'domcontentloaded' });
  const listHtml = await listPage.content();
  await listPage.close();

  // 2. Parse poem URLs from the list (same logic as before)
  const linksToScrape = extractPoemLinks(listHtml, start, end);

  // 3. Iterate sequentially with jitter
  for (let i = 0; i < linksToScrape.length; i++) {
    const page = await context.newPage();
    await page.goto(linksToScrape[i].url, { waitUntil: 'domcontentloaded' });
    const html = await page.content();
    await page.close();

    const poem = parsePoem(html, linksToScrape[i]);
    if (poem) poems.push(poem);

    // Jitter between requests (same constants as before)
    if (i < linksToScrape.length - 1) {
      const jitterMs = randomJitter(REQUEST_JITTER_MIN_MS, REQUEST_JITTER_MAX_MS, randomImpl);
      await sleepImpl(jitterMs);
    }

    // Macro-pause every 25 poems
    if ((i + 1) % MICRO_BATCH_SIZE === 0 && i < linksToScrape.length - 1) {
      const pauseMs = randomJitter(MACRO_PAUSE_MIN_MS, MACRO_PAUSE_MAX_MS, randomImpl);
      logger.info('Taking macro pause between LOC micro-batches', { pauseMs });
      await sleepImpl(pauseMs);
    }
  }
} finally {
  await browser.close();
}
```

Key design points:
- **Single `BrowserContext`** — cookies set on the list page are automatically sent on all subsequent poem page requests within the same context.
- **One page per poem, then `page.close()`** — prevents memory accumulation over 180 iterations.
- **`waitUntil: 'domcontentloaded'`** — no need to wait for JS execution; the poem content is server-rendered HTML.
- **Jitter and macro-pause constants unchanged** — same conservative pacing as the current implementation.
- **`Retry-After` / circuit breaker logic removed** — navigation failures are handled via Playwright's built-in timeout + `try/catch`; WAF blocks manifest as timeouts or redirect loops rather than 429 HTTP codes when using a real browser.

#### 1.3 — Handle the 429-as-redirect case

Some WAFs redirect blocked requests to a challenge page rather than returning a 429. Add a post-navigation check:

```typescript
const finalUrl = page.url();
if (finalUrl.includes('captcha') || finalUrl.includes('challenge') || finalUrl.includes('blocked')) {
  logger.warn('WAF challenge page detected', { sourceUrl, finalUrl });
  // Increase delay significantly and retry once
}
```

#### 1.4 — Update `Loc180ScraperOptions`

The `fetchImpl` injectable is no longer meaningful. Replace it with a Playwright-compatible hook for unit tests:

```typescript
export interface Loc180ScraperOptions {
  // For unit testing: provide a function that returns pre-canned HTML
  // given a URL, bypassing the browser entirely.
  htmlFetcherImpl?: (url: string) => Promise<string>;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
}
```

Unit tests that currently inject `fetchImpl` will need to be updated to use `htmlFetcherImpl`.

#### 1.5 — Post-scrape validation unchanged

Keep the existing `≥ 170 of 180` validation gate.

---

## Phase 0 Findings (2026-03-03)

Both JSON API endpoints were probed using Playwright MCP (real Chromium browser, same machine/IP):

**`https://www.loc.gov/search/?fa=partof:poetry+180&fo=json&c=200`** → ✅ Returns structured JSON
- `results[]` array contains all 180 poems (confirmed: numbers 1–180, none missing)
- Each entry has `url` (e.g. `https://www.loc.gov/item/poetry-180-001/introduction-to-poetry/`) and `shelf_id`
- No WAF challenge — response arrived successfully

**`https://www.loc.gov/item/poetry-180-001/introduction-to-poetry/?fo=json`** → ✅ Returns structured JSON
- `item.article` contains `<pre>poem text</pre><p>—Author Name</p>` HTML
- `item.author` = `["Collins, Billy"]` (Title-case, Last-First format)
- `item.title` = `"Introduction to Poetry"`
- `item.poem_number` = `"001"`

**Decision:** Implement JSON API approach. The scraper will use:
1. Search API to retrieve all 180 poem URLs in a single request
2. Per-poem `?fo=json` endpoint for structured content (avoiding HTML parsing)
3. Playwright browser for all HTTP (WAF bypass via real Chromium TLS)

Phase 1 (Playwright-based scraper) is still required for WAF bypass — the JSON API does not change the TLS fingerprint issue. The difference is that we parse JSON instead of HTML, which is simpler and more robust.

---

## Acceptance Criteria

- [x] Phase 0 JSON API probe completed and result documented here
- [x] `playwright` added to `@sanctuary/scraper` dependencies
- [x] `scrapeLoc180` rewritten to use `chromium.launch()` via Playwright + JSON API
- [x] Existing unit tests updated to use `htmlFetcherImpl` (or equivalent stub)
- [ ] LOC scrape retrieves ≥ 170 of 180 poems in a single run
- [ ] ETL re-run after re-scrape loads the new poems into the DB

## Running After Implementation

```bash
# Re-scrape LOC only
bun scripts/run-scrape.ts --sources loc-180

# Re-run ETL to load new poems (upsert-safe)
pnpm --filter @sanctuary/etl run pipeline --include-non-pd

# Generate AI counterparts for the ~115 new poems
bun scripts/run-generate.ts --concurrency 3
```
