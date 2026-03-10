# [SEC-001] Security and Privacy Audit Findings - March 2026

## Summary
A security and privacy audit of the Classicist's Sanctuary codebase identified two vulnerabilities: a high-severity Cross-Site Scripting (XSS) vulnerability in the frontend and a medium-severity information disclosure risk in backend logging.

## Status: OPEN
**Severity:** High  
**Priority:** P1  
**Reporter:** Gemini Security Agent  
**Date Reported:** 2026-03-09

---

## Description
During a routine security audit of the `classicist-sanctuary-proto` repository, the following vulnerabilities were discovered. These findings represent potential risks to user security and infrastructure privacy.

### Finding 1: Cross-Site Scripting (XSS) via `sourceUrl`

*   **Severity:** High
*   **Type:** Security
*   **Component:** Frontend (`apps/web`)
*   **File:** `apps/web/components/SourceInfo.tsx:46`

#### Details
The `SourceInfo` component renders a `sourceUrl` retrieved from the database directly into the `href` attribute of an `<a>` tag. While React provides default escaping for content, it does not prevent `javascript:` URI injection in `href` attributes.

```tsx
<a
  id={`${baseId}-source-link`}
  href={sourceInfo.primary.sourceUrl}
  target="_blank"
  rel="noopener noreferrer"
  className="underline underline-offset-2 hover:text-ink transition-colors"
>
  {sourceInfo.primary.source}
</a>
```

If a malicious URL (e.g., `javascript:alert('XSS')`) is present in the `poems` or `scrape_sources` tables, it will execute in the user's browser context when clicked.

#### Recommendation
Implement a URL validation utility to ensure only safe protocols (`http:`, `https:`) are allowed before rendering.

---

### Finding 2: Information Disclosure in Database Logs

*   **Severity:** Medium
*   **Type:** Privacy
*   **Component:** Backend API (`apps/api`)
*   **File:** `apps/api/src/index.ts:51-53, 76-78`

#### Details
The API logs database readiness errors directly to the console using `snapshot.lastError`. These error messages can contain sensitive information about the database infrastructure, such as internal hostnames, schema names, or driver-specific connection details.

```typescript
console.error(
  `DB readiness check failed (${snapshot.status}): ${snapshot.lastError ?? 'unknown error'}`,
);
```

#### Recommendation
Redact or sanitize error messages before logging to the console in production environments. Use generic error messages for public-facing logs while maintaining detailed logs in a secure, internal-only logging system.

---

## Acceptance Criteria
- [ ] Shared utility for URL protocol validation exists in `@sanctuary/shared`.
- [ ] `SourceInfo.tsx` uses the validation utility to sanitize `sourceUrl`.
- [ ] API readiness logging in `index.ts` is sanitized to remove internal infrastructure details.
- [ ] All unit tests pass.
