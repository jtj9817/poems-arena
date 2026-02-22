# Ticket: Optimize Deduplication Stage Performance

**Status:** Resolved
**Priority:** Medium
**Assignee:** Unassigned
**Labels:** etl, performance, phase-3

## Description

The current implementation of `runDedupStage` in `packages/etl/src/stages/02-dedup.ts` contains a performance bottleneck within the author-grouping loop.

### Issue

The code recalculates the normalized title key for existing groups in every iteration of the nested loop. `normalizeDedupKey` performs multiple regex operations (NFD normalization, replacements, trimming).

```typescript
// packages/etl/src/stages/02-dedup.ts

// ... inside the author loop ...
for (const group of titleGroups) {
  // EXPENSIVE: This is re-calculated for every poem comparison
  const groupTitleKey = normalizeDedupKey(group[0].title);
  if (isFuzzyMatch(titleKey, groupTitleKey)) {
    group.push(poem);
    matched = true;
    break;
  }
}
```

For an author with $N$ poems, this results in roughly $\frac{N^2}{2}$ calls to `normalizeDedupKey` for the group heads alone. For 1,000 poems (e.g., Emily Dickinson), this is ~500,000 regex chains.

### Proposed Solution

Refactor `titleGroups` to store the normalized key alongside the poem group to compute it exactly once per group.

```typescript
// Suggested Data Structure
type TitleGroup = {
  key: string;
  poems: CleanPoem[];
};

// ...

const titleGroups: TitleGroup[] = [];

for (const poem of poems) {
  const titleKey = normalizeDedupKey(poem.title);
  let matched = false;

  for (const group of titleGroups) {
    if (isFuzzyMatch(titleKey, group.key)) {
      // Use cached key
      // ...
    }
  }

  if (!matched) {
    titleGroups.push({ key: titleKey, poems: [poem] });
  }
}
```

## Context

- **Commit:** `cdce3e5`
- **File:** `packages/etl/src/stages/02-dedup.ts`

## Resolution

**Status:** Resolved
**Verified on:** 2026-02-21

The optimization described in this ticket was confirmed as fully implemented in `packages/etl/src/stages/02-dedup.ts`.

The `titleGroups` array now uses the object structure `{ key: string; poems: CleanPoem[] }[]` proposed in the ticket. The normalized title key is computed exactly once when a new group is created (`titleGroups.push({ key: titleKey, poems: [poem] })`), and subsequent comparisons reference `group.key` directly rather than re-calling `normalizeDedupKey` on the group head:

```typescript
// Current implementation (02-dedup.ts, lines 244–263)
const titleGroups: { key: string; poems: CleanPoem[] }[] = [];

for (const poem of poems) {
  const titleKey = normalizeDedupKey(poem.title);
  let matched = false;

  for (const group of titleGroups) {
    if (isFuzzyMatch(titleKey, group.key)) {
      // uses cached key
      group.poems.push(poem);
      matched = true;
      break;
    }
  }

  if (!matched) {
    titleGroups.push({ key: titleKey, poems: [poem] });
  }
}
```

The comment on line 243 explicitly states: "Array of objects, where each object caches the normalized title key and a group of matched poems". The fix is consistent with the proposed solution. No further action required.
