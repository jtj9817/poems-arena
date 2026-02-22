# Phase 2 Live Verification Failures: LOC 180 and Poets.org Scrapers

**Ticket Type**: Bug
**Status**: Completed
**Priority**: High
**Assignee**: Gemini CLI
**Labels**: scraper, phase-2, regression, integration-test, parser
**Detected On**: February 20, 2026
**Completed On**: February 20, 2026

## Summary

The Phase 2 manual verification runner fails during live integration (`test:live`) because the LOC 180 scraper returns zero poems (404 on configured URL pattern), and the Poets.org scraper extracts URLs but fails to parse poem body content from live detail pages.

This is a scraper implementation issue, not a verification script orchestration issue.

## Evidence

Latest failing verification log:

- `logs/manual-verification-phase-2-20260220-153600.log`

Observed failures in that log:

- `live scraper integration > scrapes at least one poem from LOC Poetry 180...` failed (`Expected > 0, Received 0`)
- `live scraper integration > scrapes at least one poem from Poets.org...` failed (`Expected > 0, Received 0`)
- `live scraper integration > stores at least three scraped poems...` failed (`Expected >= 3, Received 1`)

The same log shows:

- Gutenberg live scrape succeeded (`poemCount: 224`)
- Script executed expected steps in sequence and failed at Step 3 when `pnpm --filter @sanctuary/scraper test:live` failed

## Scope and Impact

### User/Workflow Impact

- `scripts/run-manual-verification-phase-2.sh` is not reliable for release-gating in network-available environments.
- Phase 2 verification cannot be considered complete when live source behavior regresses.

### Technical Impact

- LOC source coverage is effectively broken in live mode.
- Poets.org source coverage is significantly degraded due to parser mismatch.
- Downstream ETL/data ingestion is at risk of ingesting incomplete or empty source sets.

## Files and Functions Involved

### Primary

- `packages/scraper/src/scrapers/loc-180.ts`
  - `scrapeLoc180`
  - URL construction based on numeric `001.html` pattern
- `packages/scraper/src/scrapers/poets-org.ts`
  - `getPoemUrls`
  - `scrapePoetsOrg`
  - content extraction selector chain
- `packages/scraper/src/utils/html.ts`
  - `extractFirstClassInnerHtml`
  - regex-based HTML extraction strategy
- `packages/scraper/src/parsers/poem-parser.ts`
  - `parsePoemContent`
- `packages/scraper/src/scrapers/live-scrape.test.ts`
  - live assertions requiring at least one poem per source and total >= 3

### Orchestration (validated as correct)

- `scripts/run-manual-verification-phase-2.sh`
  - Step sequencing, fail-fast behavior, and logging are functioning as expected.

## Root Cause Analysis

### 1) LOC 180 URL strategy is stale or incorrect for current site routing

Current implementation assumes:

- `https://www.loc.gov/.../poetry-180/001.html`

In the failing run, this endpoint returns 404 (`statusText: "Standard 40x"`).

Consequence:

- `scrapeLoc180(1,1)` returns `[]`
- live test fails on `expect(poems.length).toBeGreaterThan(0)`

### 2) Poets.org poem body selectors are not matching current live page structure

Current extraction chain relies on class-based containers:

- `field--name-body`
- `field--name-field-poem-body`
- `poem-body`
- `field--name-field-poem`

In the failing run, list extraction finds 20 poem URLs, but detail parsing repeatedly logs `No poem content found...`, resulting in `poemCount: 0`.

Consequence:

- live Poets.org test fails
- final row-count assertion fails because only Gutenberg row is inserted

### 3) HTML utility layer is regex-only and brittle for nested modern markup

`extractFirstClassInnerHtml` and related helpers use regex patterns that are fragile with deep nesting, varied attribute ordering, and dynamic CMS templates.

Consequence:

- selector drift causes silent content extraction misses
- parser robustness is significantly lower than required for live source variability

## Why This Is Not a Script Bug

`scripts/run-manual-verification-phase-2.sh`:

- correctly runs the documented commands
- correctly exits on first failing command (`set -euo pipefail`)
- correctly logs command output to timestamped logs

Failure happens because `test:live` assertions fail due to scraper results, not because script logic is wrong.

## Suggested Fix Direction

### A) LOC 180: switch from numeric URL synthesis to index-page discovery

1. Scrape the authoritative Poetry 180 index page (`all-poems`) and collect detail links.
2. Follow discovered links instead of generating `001..180.html` URLs.
3. Keep fallback for legacy numeric URLs only if discovered links are unavailable.
4. Add structured warning if discovered link count is below threshold.

### B) Poets.org: strengthen detail content extraction

1. Inspect current live DOM structure and update selectors to target canonical poem container(s).
2. Add fallback extraction from structured metadata if available (e.g., JSON-LD / script payload), when DOM selectors fail.
3. Reject pages only after all extraction strategies fail.
4. Log which extraction strategy succeeded for observability.

### C) Parser/HTML extraction reliability

1. Replace regex-only HTML matching with a resilient DOM parser strategy for scraper runtime.
2. Ensure nested elements, mixed containers, and attribute ordering do not break extraction.
3. Add parser regression fixtures from current live pages.

### D) Live integration test resiliency

1. Keep offline bypass behavior.
2. In online mode, keep strict correctness assertions but include source-specific diagnostics in failure output.
3. Store sampled raw HTML for failing pages in test artifacts for debugging.

## Acceptance Criteria

1. Running `CI=true scripts/run-manual-verification-phase-2.sh` passes in a network-available environment.
2. `scrapeLoc180` returns at least one valid poem via discovered live links.
3. `scrapePoetsOrg(1)` returns at least one valid poem from current live detail pages.
4. `live-scrape.test.ts` inserts >= 3 rows total (Gutenberg + LOC + Poets) when network is available.
5. No regressions in existing unit tests (`pnpm --filter @sanctuary/scraper test`, `pnpm --filter @sanctuary/api test -- src/db/config.test.ts`).

## Implementation Checklist

- [ ] Update LOC scraper to link-discovery approach
- [ ] Update Poets.org selectors with validated live DOM strategy
- [ ] Improve HTML extraction utility robustness
- [ ] Add/refresh fixtures for LOC and Poets live HTML structures
- [ ] Add tests covering new fallback extraction paths
- [ ] Re-run full Phase 2 verification script and attach passing log

## Reproduction Steps

1. Run: `CI=true scripts/run-manual-verification-phase-2.sh`
2. Observe failure during Step 3 (`test:live`) on LOC and Poets assertions.
3. Inspect log in `logs/manual-verification-phase-2-*.log`.

## Notes for Implementer

- Keep verbose structured logging; it provided essential diagnosis in this incident.
- Do not weaken live assertions to hide scraper breakage; fix extraction and URL discovery logic.
- Preserve test DB isolation semantics (`SCRAPER_TEST_DB_PATH`, `LIBSQL_TEST_URL`).

## Current Status

**Status:** Partially Resolved
**Verified on:** 2026-02-21

Code inspection of the scraper files reveals that the LOC 180 fix has been implemented, while the Poets.org content extraction issue remains unchanged.

### LOC 180 (Root Cause 1): Resolved

The LOC 180 scraper was rewritten to use the link-discovery approach recommended in Fix Direction A. It now fetches the authoritative index page directly:

```typescript
// loc-180.ts (line 8–9)
const LIST_URL =
  'https://www.loc.gov/programs/poetry-and-literature/poet-laureate/poet-laureate-projects/poetry-180/all-poems/';
```

It discovers poem links by filtering anchors whose `href` includes `/item/poetry-180-`, handles `start`/`end` range filtering, deduplicates URLs, and resolves relative paths to absolute URLs. A full try-catch wraps the entire discovery-and-scrape operation. The log message was updated to read `"Starting LOC Poetry 180 scrape (discovery mode)"`. The numeric URL generation pattern (`001.html` through `180.html`) has been removed. The `loadHtml`/cheerio-based strategy replaces the regex HTML extraction for content parsing.

### Poets.org (Root Cause 2): Open

The `scrapePoetsOrg` function in `packages/scraper/src/scrapers/poets-org.ts` still relies on the same selector chain documented in the original failure:

```typescript
const contentHtml = extractFirstClassInnerHtml(html, [
  'field--name-body',
  'field--body',
  'field--name-field-poem-body',
  'poem-body',
  'field--name-field-poem',
]);
```

`field--body` was added as a new candidate class, but the fundamental extraction strategy (regex-based `extractFirstClassInnerHtml`) has not changed to a DOM parser approach. If the live Poets.org DOM does not match these selectors, extraction will still silently fail.

### Root Cause 3 (HTML Extraction Robustness): Partially Resolved

The LOC 180 scraper was updated to use `loadHtml` (a cheerio-based DOM loader imported from `../utils/html`) for content extraction, which addresses the brittleness for that source. The Poets.org scraper continues to use `extractFirstClassInnerHtml` which is the regex-based utility.

### Implementation Checklist Status

- [x] Update LOC scraper to link-discovery approach — implemented
- [ ] Update Poets.org selectors with validated live DOM strategy — not yet addressed
- [ ] Improve HTML extraction utility robustness for Poets.org — not yet addressed
- [ ] Add/refresh fixtures for LOC and Poets live HTML structures — not verified
- [ ] Add tests covering new fallback extraction paths — not verified
- [ ] Re-run full Phase 2 verification script and attach passing log — not confirmed
