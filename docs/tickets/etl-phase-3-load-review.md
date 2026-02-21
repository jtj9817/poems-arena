# Review: ETL Phase 3 - Stage 4 Load Implementation

**Commit:** `adcb459`
**Date:** 2026-02-21
**Reviewer:** Gemini CLI

## Context

Implementation Plan - Phase 3: ETL Pipeline (`conductor/tracks/etl_pipeline_20260220/plan.md`)

## Findings

### 1. [Critical] Unsafe Access to `provenances[0]`

**File:** `packages/etl/src/stages/04-load.ts`
**Location:** `loadPoem` function

The code assumes `poem.provenances` is never empty:

```typescript
const primaryProvenance = poem.provenances[0];
// ...
source: primaryProvenance.source, // Throws if undefined
```

If `poem.provenances` is empty, this will crash the ETL process. While previous stages might filter this, the `load` stage should be robust or explicitly validate this assumption.

**Recommendation:**
Add a guard clause or validation:

```typescript
if (!poem.provenances.length) {
  throw new Error(`Poem ${poemId} has no provenance`);
}
```

### 2. [High] Performance Bottleneck: Sequential Transactions

**File:** `packages/etl/src/stages/04-load.ts`
**Location:** `runLoadStage` loop

The current implementation processes each poem in a separate database transaction within a synchronous loop:

```typescript
for await (const line of rl) {
  // ...
  await loadPoem(db, poem); // Opens/commits transaction per line
}
```

For large datasets (e.g., Gutenberg), this will be significantly slower than necessary due to transaction overhead and fsync latency.

**Recommendation:**
Implement batch processing. Accumulate `TagPoem` objects into a buffer (e.g., size 500) and commit them in a single transaction.

### 3. [Medium] ID Generation Collision Risk

**File:** `packages/etl/src/utils/id-gen.ts`
**Location:** `generatePoemId` / `generateScrapeSourceId`

The hashing function uses `:` as a delimiter after normalization:

```typescript
hashToId(`poem:${normalize(title)}:${normalize(author)}`);
```

Since `normalize` preserves punctuation (only trims and collapses whitespace), a collision is possible if the title/author contains the delimiter at the boundary.

- Title: "Foo:", Author: "Bar" -> "poem:foo::bar"
- Title: "Foo", Author: ":Bar" -> "poem:foo::bar"

**Recommendation:**
Use a delimiter that cannot exist in the input (e.g., `\0` null character) or length-prefix the segments.

### 4. [Low] Batch Topic Upsert

**File:** `packages/etl/src/stages/04-load.ts`
**Location:** `upsertTopics`

Topics are inserted one by one in a loop. While `CANONICAL_TOPICS` is small (20), it is more efficient to perform a single batch insert if the ORM/Driver supports it.
