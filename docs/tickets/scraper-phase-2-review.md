# Scraper Phase 2 Code Review Findings

**Status**: Open
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
