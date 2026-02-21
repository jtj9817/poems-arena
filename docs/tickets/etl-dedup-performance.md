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
