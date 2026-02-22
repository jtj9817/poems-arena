# Scraper Phase 2 Code Review Findings

**Status**: Partially Resolved
**Priority**: High
**Assignee**: Unassigned
**Labels**: scraper, technical-debt, bug

## Overview

Review of commit f624157 implementing initial scrapers for Gutenberg, LOC 180, and Poets.org.

## Critical Issues

### 1. Missing Error Handling in Gutenberg Scraper

**File**: `packages/scraper/src/scrapers/gutenberg.ts`
**Severity**: High
**Description**: The `scrapeGutenbergEmerson` function performs a `fetch` call without a `try-catch` block or a check for `response.ok`. Network failures will cause unhandled promise rejections.
**Recommendation**: Wrap the fetch in a try-catch block and validate `response.ok`.

### 2. Flawed Public Domain Detection

**File**: `packages/scraper/src/scrapers/poets-org.ts`
**Severity**: Medium
**Description**: The heuristic `!bodyText.includes('Copyright')` checks the entire body text. Since most websites include a copyright notice in their footer (e.g., "© 2024 Academy of American Poets"), this check will almost always return `false`, potentially misclassifying public domain poems.
**Recommendation**: Refine the selector to target poem metadata specifically, or remove the body-wide check.

## Improvements

### 3. Code Duplication

**Files**: `gutenberg.ts`, `loc-180.ts`, `poets-org.ts`
**Severity**: Medium
**Description**: The `generateSourceId` function is duplicated in all three scraper files.
**Recommendation**: Extract `generateSourceId` to a shared utility file (e.g., `src/utils/hashing.ts`).

## Resolution

**Status:** Partially Resolved
**Verified on:** 2026-02-21

### Finding 1 — Missing Error Handling in Gutenberg Scraper: Resolved

`scrapeGutenbergEmerson` in `packages/scraper/src/scrapers/gutenberg.ts` now has both a `response.ok` check and a try-catch wrapping the entire fetch-and-parse operation. Non-200 responses log an error and return `[]`. Exceptions are caught, logged, and also return `[]`:

```typescript
// gutenberg.ts (lines 68–96)
try {
  const response = await fetchImpl(url);
  if (!response.ok) {
    logger.error('Failed to fetch Gutenberg source page', undefined, { ... });
    return [];
  }
  // ...
} catch (error) {
  logger.error('Unhandled Gutenberg scraping error', error, { ... });
  return [];
}
```

### Finding 2 — Flawed Public Domain Detection: Partially Resolved

The `detectPublicDomain` function in `packages/scraper/src/scrapers/poets-org.ts` was improved. It now first checks theme metadata for a `'public domain'` label, then searches within targeted copyright-specific HTML class containers (`field--name-field-copyright`, `field--name-field-credits`) before falling back to the body-wide `pageHtml` check:

```typescript
function detectPublicDomain(pageHtml: string, themes: string[]): boolean {
  const themeContainsPublicDomain = themes.some((theme) =>
    theme.toLowerCase().includes('public domain'),
  );
  if (themeContainsPublicDomain) return true;

  const copyrightFieldHtml = extractFirstClassInnerHtml(pageHtml, [
    'field--name-field-copyright',
    'field--name-field-credits',
  ]);

  return (
    hasCaseInsensitiveText(copyrightFieldHtml, 'public domain') ||
    hasCaseInsensitiveText(pageHtml, 'public domain')
  );
}
```

The targeted field check now runs first, reducing false negatives. However, the body-wide `hasCaseInsensitiveText(pageHtml, 'public domain')` fallback remains. This means a site footer containing "Public Domain" in a general copyright notice could still produce a false positive. The recommendation to remove the body-wide check entirely has not been applied.

### Finding 3 — Code Duplication in generateSourceId: Resolved

`generateSourceId` has been extracted to `packages/scraper/src/utils/hashing.ts`. All three scraper files now import it from that shared utility:

```typescript
// gutenberg.ts, loc-180.ts, poets-org.ts
import { generateSourceId } from '../utils/hashing';
```

No local copies of the function remain in any scraper file.
