# Ticket: AI Poem Generation Service (Phase 2) Review Findings

**Status:** Open
**Priority:** High
**Assignee:** Unassigned
**Labels:** ai-gen, phase-2, review, bug, style

## Description

A review of the Phase 2 implementation for the AI Poem Generation Service (`packages/ai-gen`) identified several deviations from the implementation plan and the Google TypeScript Style Guide.

### 1. [High] Incorrect Default Model Version

**File:** `packages/ai-gen/src/gemini-client.ts`
**Location:** Line 31
**Context:** The `plan.md` explicitly specifies using `gemini-3-flash-preview` for generation, but the code defaults to `gemini-2.0-flash-preview`.
**Proposed Solution:**
Update the default model constant:

```typescript
const DEFAULT_MODEL = 'gemini-3-flash-preview';
```

### 2. [High] Incorrect Default Model Version for Verification

**File:** `packages/ai-gen/src/verification-agent.ts`
**Location:** Line 19
**Context:** The `plan.md` specifies using `gemini-3-flash-preview` for verification as well.
**Proposed Solution:**
Update the verification model constant:

```typescript
const VERIFICATION_MODEL = 'gemini-3-flash-preview';
```

### 3. [Medium] Forbidden `public` Modifier

**Files:**

- `packages/ai-gen/src/gemini-client.ts` (Line 24)
- `packages/ai-gen/src/verification-agent.ts` (Line 12)
  **Context:** The Google TypeScript Style Guide explicitly forbids the use of the `public` modifier as it is the default visibility in TypeScript.
  **Proposed Solution:**
  Remove the `public` modifier from the `cause` parameter in the custom error classes:

```typescript
// Before
public readonly cause?: Error,

// After
readonly cause?: Error,
```

### 4. [Medium] Unsafe Type Assertion (`as`) with JSON.parse

**Files:**

- `packages/ai-gen/src/gemini-client.ts` (Lines 83-86)
- `packages/ai-gen/src/verification-agent.ts` (Lines 84-86)
  **Context:** The Google TypeScript Style Guide advises against type assertions (`as`). Using `as PoemOutput` or `as PoemVerificationResult` directly on `JSON.parse` output is unsafe because `JSON.parse` could return `null` or a completely different object structure, causing property access to throw a `TypeError` before the validation logic can catch it.
  **Proposed Solution:**
  Cast to a `Partial` type or `unknown`, and ensure null checks are in place before property access.

**gemini-client.ts:**

```typescript
const parsed = JSON.parse(responseText) as Partial<PoemOutput> | null;

if (!parsed || !parsed.title || !parsed.content) {
  // throw error
}
```

**verification-agent.ts:**

```typescript
const parsed = JSON.parse(responseText) as Partial<PoemVerificationResult> | null;

if (
  !parsed ||
  typeof parsed.isValid !== 'boolean' ||
  typeof parsed.score !== 'number' ||
  typeof parsed.feedback !== 'string'
) {
  // throw error
}
```
