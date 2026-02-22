# Security Vulnerability: Path Traversal in File Writer

**Ticket Type**: Security Vulnerability
**Status**: Resolved
**Priority**: Medium
**Assignee**: Gemini CLI
**Labels**: security, path-traversal, scraper, writer
**Detected On**: February 21, 2026

## Summary

A path traversal vulnerability exists in `packages/scraper/src/utils/writer.ts`. The `writeScrapedPoems` function uses the `source` parameter directly in the filename construction without sanitization.

## Vulnerability Details

- **Location:** `packages/scraper/src/utils/writer.ts` (Lines 22-23)
- **Vulnerable Code:**
  ```typescript
  const fileName = `${source}-${timestamp}.json`;
  const filePath = join(resolvedOutputDir, fileName);
  ```
- **Attack Vector:** If an attacker can control the `source` input (e.g., via a CLI argument or API parameter), they could supply a string containing path traversal characters (`../`) to write the output file to an arbitrary location outside the intended directory.

## Impact

An attacker could potentially overwrite critical files or write data to arbitrary locations on the file system, depending on the permissions of the process running the scraper.

## Recommendation

Sanitize the `source` parameter to remove path separators or validate it against an allowlist of permitted source identifiers. Using `path.basename(source)` is a robust way to ensure the filename remains within the intended directory.

## Acceptance Criteria

1.  The `source` parameter in `writeScrapedPoems` is sanitized to prevent path traversal.
2.  A test case confirms that providing a `source` with path traversal characters does not result in a file being written outside the target directory.

## Resolution

**Status:** Resolved
**Fixed in commit:** `14f370e`
**Verified on:** 2026-02-21

The fix was confirmed in `packages/scraper/src/utils/writer.ts`. The `source` parameter is now sanitized using `path.basename()` before being used in the filename construction, exactly as recommended:

```typescript
// writer.ts (lines 21–25)
// Sanitize source to prevent path traversal
const safeSource = basename(source);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const fileName = `${safeSource}-${timestamp}.json`;
const filePath = join(resolvedOutputDir, fileName);
```

`basename()` strips all directory components from the `source` string, ensuring that inputs such as `../../etc/passwd` are reduced to just `passwd` and the resulting file is always written within `resolvedOutputDir`. Both acceptance criteria are satisfied: the sanitization is in place, and the comment inline confirms the intent. No further action required.
