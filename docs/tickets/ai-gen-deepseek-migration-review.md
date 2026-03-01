# [TASK] Review Findings: AI Gen DeepSeek Migration

**Date:** 2026-03-01
**Status:** Open
**Priority:** High
**Labels:** `ai-gen`, `review`, `bug`
**Parent:** [`docs/tickets/ai-gen-deepseek-migration.md`](ai-gen-deepseek-migration.md)

## Summary of Findings

A review of commit `3fc74f1` against the migration plan revealed significant logic and performance issues related to retry handling. While the core DeepSeek integration, JSON parsing, and concurrency changes were implemented correctly, the error handling does not conform to the plan's instructions, resulting in excessive cascading retries.

## Findings

### 1. Logic Correctness / Performance

**File:** `packages/ai-gen/src/cli.ts` (Lines ~160-190) & `packages/ai-gen/src/generation-service.ts` (Lines ~50-90)
**Issue:** Compounding retry loops cause up to 27 network requests per failing poem. The OpenAI SDK retries twice (3 attempts), `generation-service.ts` retries twice (3 attempts), and `cli.ts` pushes failures back to the queue to retry twice (3 attempts) (3 _ 3 _ 3 = 27 attempts). This wastes API credits and significantly slows down the pipeline on persistent failures.
**Recommended Fix:** Remove the application-level retry loop from `cli.ts` entirely. Let `generation-service.ts` handle application-level retries (quality validation / JSON parsing), while the OpenAI SDK handles network retries. `cli.ts` should only manage the concurrency queue and log permanent failures.

### 2. Plan Conformance / Logic Correctness

**File:** `packages/ai-gen/src/generation-service.ts` (Line ~87)
**Issue:** The commit failed to delineate SDK retries from application-level retries as instructed by the migration plan. The `generation-service.ts` script catches all errors blindly (`catch (error)`) and retries them, failing to distinguish between network-level errors (which are already retried by the OpenAI SDK) and application-level failures like JSON parsing or quality validation.
**Recommended Fix:** Update the `catch` block in `generation-service.ts` to inspect the error type. If the error is a network-level error, throw it immediately without retrying. Only retry for specific `PoemGenerationError`s related to empty content, missing fields, or invalid JSON structure.

### 3. Frontend↔Backend Alignment

**Status:** N/A
**Note:** The commit exclusively modifies the backend worker/CLI package (`@sanctuary/ai-gen`). No web frontend (`apps/web`) or Hono API routes (`apps/api`) were modified or affected.

### 4. Type Safety

**Status:** Pass
**Note:** `JSON.parse` outputs are safely cast to `Partial<...>` and thoroughly type-checked at runtime for required properties without relying on unsafe `any` casts.

## Acceptance Criteria for Fixes

- [ ] `cli.ts` no longer pushes failed poems back to `failedQueue` for redundant retries.
- [ ] `generation-service.ts` distinguishes between validation/parse errors and network errors, only retrying the former.
- [ ] Failing poems result in a maximum of 3 application attempts per poem (with OpenAI handling its own internal network retries).
