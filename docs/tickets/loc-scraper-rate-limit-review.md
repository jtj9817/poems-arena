# [FINDINGS] Review of commit b6f02c0 (LOC Scraper Rate Limit)

**Date:** 2026-03-01
**Status:** Resolved
**Priority:** Low
**Labels:** `scraper`, `review-findings`
**Parent:** `docs/tickets/loc-scraper-rate-limit.md`

## Overview
A comprehensive review of commit `b6f02c0` (and `76c0a3a`) was performed against the `loc-scraper-rate-limit.md` requirements. The plan was executed successfully: baseline pacing was lowered, retries with backoff were implemented (along with `Retry-After` HTTP-date parsing in `76c0a3a`), a global circuit breaker was added, and post-scrape validation is in place.

However, a couple of minor logic issues were identified during the review.

## Findings

### 1. Logic Correctness: Circuit Breaker Race Condition
* **File:** `packages/scraper/src/scrapers/loc-180.ts`, line 78
* **Description:** The global circuit breaker uses an `if (Date.now() < globalPauseUntil)` statement. If another concurrent request updates `globalPauseUntil` while the current task is already waiting in the `setTimeout`, the current task will wake up and immediately send a request, bypassing the newly extended pause window.
* **Recommended Fix:** Change the `if` statement to a `while` loop so that when the task wakes up, it re-evaluates the circuit breaker before proceeding:
  ```typescript
  while (Date.now() < globalPauseUntil) {
    const waitTime = globalPauseUntil - Date.now();
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  ```

### 2. Logic Correctness: Retry Loop Catches Parsing Errors
* **File:** `packages/scraper/src/scrapers/loc-180.ts`, line 83 (try block) & line 208 (catch block)
* **Description:** The `try...catch` block encompasses both the network request (`fetchImpl`) and the synchronous HTML parsing logic. If an unexpected error occurs during parsing (e.g., an exception in `parsePoemContent`), it will be caught and treated as a network error, causing the scraper to pointlessly retry the request 4 times with exponential backoff.
* **Recommended Fix:** Narrow the scope of the `try...catch` to only wrap `fetchImpl(url)` and `response.text()`, or explicitly inspect the error type in the `catch` block to ensure only network errors trigger a retry.

### 3. Plan Conformance
* **Status:** Passed. All requirements from the original ticket were successfully implemented.

### 4. API Alignment & Performance
* **Status:** N/A. The reviewed commit exclusively modified backend scraper logic and test files; there were no changes to API routes, shared types, or frontend React components.

### 5. Type Safety
* **Status:** Passed. No type safety issues found. The commit successfully avoids `any` casts, properly handles nulls/optionals, and integrates safely with the shared types.
