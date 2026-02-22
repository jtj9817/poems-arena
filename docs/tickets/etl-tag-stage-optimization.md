# Ticket: Optimize Tag Stage Performance and Memory Usage

**Status:** Closed
**Priority:** High
**Assignee:** Unassigned
**Labels:** etl, performance, phase-3

## Description

The current implementation of Phase 3 (Tagging) in `packages/etl` introduces performance inefficiencies in the keyword extraction logic and a potential memory bottleneck in the stage runner.

### 1. Regex Performance in Keyword Extraction

**Location:** `packages/etl/src/mappings/theme-to-topic.ts`

**Issue:**
The `extractTopicsFromKeywords` function iterates through `KEYWORD_TOPICS` (20 topics) and their `keywords` lists (~10 words each). For every keyword, it calls `containsWholeWord`, which constructs a **new RegExp object** on every call.

```typescript
function containsWholeWord(text: string, keyword: string): boolean {
  // ...
  return new RegExp(`\b${escaped}\b`, 'i').test(text); // <--- Expensive recompilation
}
```

For a single poem falling back to keyword extraction, this results in ~200 RegExp compilations. Across a large dataset (e.g., 40,000 poems), this creates unnecessary CPU overhead.

**Proposed Solution:**
Pre-compile the regular expressions. Since we want to check if _any_ of a topic's keywords match, we can optimize further by combining keywords into a single RegExp per topic:

```regex
/\b(sea|ocean|wave|...)\b/i
```

This reduces the complexity from ~200 checks per poem to exactly 20 checks per poem.

**Suggested Change:**

```typescript
// packages/etl/src/mappings/theme-to-topic.ts

// 1. Define pre-compiled regexes in the mapping structure
const KEYWORD_MATCHERS: ReadonlyArray<{
  readonly matcher: RegExp;
  readonly topic: CanonicalTopic;
}> = KEYWORD_TOPICS.map(({ keywords, topic }) => ({
  topic,
  // Combine keywords: \b(k1|k2|k3)\b
  matcher: new RegExp(`\b(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\]/g, '\$&')).join('|')})\b`, 'i')
}));

// 2. Update extraction logic
export function extractTopicsFromKeywords(title: string, content: string): CanonicalTopic[] {
  const text = `${title} ${content}`;
  const seen = new Set<CanonicalTopic>();

  for (const { matcher, topic } of KEYWORD_MATCHERS) {
    if (matcher.test(text)) {
      seen.add(topic);
    }
  }
  return Array.from(seen);
}
```

### 2. Memory Buffering in Tag Stage

**Location:** `packages/etl/src/stages/03-tag.ts`

**Issue:**
The `runTagStage` function accumulates all processed `TagPoem` objects in an in-memory array (`taggedPoems`) before writing them to disk at the end of the execution.

```typescript
const taggedPoems: TagPoem[] = [];

// ... inside loop ...
taggedPoems.push({ ...poem, topics });

// ... after loop ...
// Write results
```

For a full dataset (40k+ poems), this holds the entire corpus in memory, which may lead to OOM errors on constrained environments (like Cloud Run with low memory limits).

**Proposed Solution:**
Switch to a streaming write approach. Open the output file handle before the processing loop and write records incrementally (or in small batches) as they are processed.

**Suggested Change:**

```typescript
// packages/etl/src/stages/03-tag.ts

// ... setup ...
let fileHandle: fs.promises.FileHandle | undefined;
if (!config.dryRun) {
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fileHandle = await fs.promises.open(join(outputDir, `tag-${timestamp}.ndjson`), 'w');
}

try {
  outer: for (const filePath of files) {
    // ... read loop ...
    for await (const line of rl) {
       // ... processing ...
       const tagPoem = { ...poem, topics };

       if (fileHandle) {
         await fileHandle.write(JSON.stringify(tagPoem) + '
');
         summary.written++;
       }
    }
  }
} finally {
  await fileHandle?.close();
}
```

## Additional Notes

- `packages/etl/src/mappings/theme-to-topic.ts`: The keyword "hunger" appears twice in the 'desire' topic list.

## Resolution

**Status:** Resolved
**Verified on:** 2026-02-21

Both optimizations described in this ticket were confirmed as implemented.

### 1. Regex Pre-compilation: Resolved

`KEYWORD_MATCHERS` is now pre-compiled at module load time in `packages/etl/src/mappings/theme-to-topic.ts` (lines 615–624). Each topic's keywords are escaped and joined into a single combined `\b(k1|k2|...)\b` regex, matching the suggested change exactly:

```typescript
// theme-to-topic.ts (lines 615–624)
const KEYWORD_MATCHERS: ReadonlyArray<{
  readonly matcher: RegExp;
  readonly topic: CanonicalTopic;
}> = KEYWORD_TOPICS.map(({ keywords, topic }) => ({
  topic,
  matcher: new RegExp(
    `\\b(${keywords.map((k) => k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})\\b`,
    'i',
  ),
}));
```

`extractTopicsFromKeywords` iterates `KEYWORD_MATCHERS` and calls `matcher.test(text)` directly — no `new RegExp` is created during processing.

### 2. Memory Buffering in Tag Stage: Resolved

`runTagStage` in `packages/etl/src/stages/03-tag.ts` no longer accumulates results in a `taggedPoems` array. It opens a `FileHandle` lazily on first write and writes records incrementally, closing in a `finally` block:

```typescript
// 03-tag.ts (lines 76, 122–130, 136–140)
let fileHandle: fs.promises.FileHandle | undefined;
// ...
if (!config.dryRun) {
  if (!fileHandle) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = join(outputDir, `tag-${timestamp}.ndjson`);
    fileHandle = await fs.promises.open(outFile, 'w');
  }
  await fileHandle.write(JSON.stringify(tagPoem) + '\n');
  summary.written++;
}
// ...
} finally {
  if (fileHandle) {
    await fileHandle.close();
  }
}
```

### Duplicate keyword note

The duplicate "hunger" keyword noted in the additional notes section was not present in the current `KEYWORD_TOPICS` definition. The 'desire' entry reads: `['desire', 'crave', 'yearn', 'hunger', 'thirst', 'longing', 'lust']` — "hunger" appears only once. This minor issue appears to have been fixed as well.
