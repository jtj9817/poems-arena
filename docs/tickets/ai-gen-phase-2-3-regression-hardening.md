# Ticket: Harden Phase 2-3 Regression Suite for AI Generation Contracts

**Ticket Type:** Test Infrastructure / Regression Hardening
**Status:** Completed
**Priority:** High
**Assignee:** Unassigned
**Labels:** ai-gen, phase-2, phase-3, testing, regression

## Why

Phase 2 and Phase 3 logic is implemented, but the current test suite does not fully lock the behavioral contracts required by the implementation plan.

### 1) Phase 2 contract coverage is shallow in key areas

- `packages/ai-gen/src/gemini-client.test.ts` validates returned shape but does not strictly assert the outbound Gemini request payload.
- Core API-call contract fields are not deeply guarded by tests:
  - `responseMimeType: 'application/json'`
  - `responseSchema` object structure
  - default model fallback (`gemini-3-flash-preview`)
  - default temperature fallback (`1.0`)
  - conditional inclusion/omission of optional config keys (`thinkingConfig`, `maxOutputTokens`)
- Negative-path parsing coverage is incomplete:
  - malformed JSON response behavior is not explicitly tested
  - valid JSON with invalid shape is only partially covered

### 2) Verification-agent tests do not fully enforce request semantics

- `packages/ai-gen/src/verification-agent.test.ts` does not assert the exact payload passed to `generateContent`.
- Prompt integrity is not strictly validated (title/content propagation into prompt text).
- Error-path coverage is incomplete for malformed JSON and structurally invalid verification payloads.

### 3) Prompt-builder tests are mostly substring checks

- `packages/ai-gen/src/prompt-builder.test.ts` currently checks generic text presence but does not sufficiently assert:
  - precise line-count tolerance instruction formatting
  - JSON-only output constraints with escaped newline semantics
  - original-poem-title contextual instruction behavior

### 4) Phase 3 validator tests need stronger boundary and issue-matrix coverage

- `packages/ai-gen/src/quality-validator.test.ts` covers core rejects/accepts but lacks complete boundary assertions around exact tolerance edges.
- The tests do not fully verify combined-issue behavior and `shouldRetry` semantics for non-retryable issue combinations.
- Meta-text pattern safety requires false-positive checks to avoid over-rejecting valid poems.

### 5) Cross-phase risk

Phase 3 validation consumes Phase 2 output contracts. If Phase 2 request/response contracts regress, Phase 3 behavior can appear correct while upstream assumptions are broken. A stricter regression suite must begin at Phase 2 and then verify Phase 3 rules on top of that stable contract.

## How

### A) Strengthen Phase 2 tests (`prompt-builder`, `gemini-client`, `verification-agent`)

1. Update `prompt-builder` tests to assert exact contract text and context behavior:
   - tolerance window string for specific input values
   - strict JSON-only response instruction with `\\n` line break requirement
   - optional original-poem-title clause inclusion

2. Update `gemini-client` tests to inspect mock call arguments and enforce outbound payload contract:
   - default model and temperature when omitted
   - explicit model override behavior
   - `responseMimeType` and schema wiring
   - system instruction propagation
   - optional fields included only when provided (`thinkingConfig`, `maxOutputTokens`)

3. Expand `gemini-client` error tests:
   - empty response
   - malformed JSON
   - valid JSON with invalid shape
   - underlying SDK rejection wrapped as `PoemGenerationError`

4. Update `verification-agent` tests to assert:
   - prompt contains both title and content
   - default model and optional model override behavior
   - JSON mode, schema, and `temperature: 0.7` config
   - malformed JSON and invalid response shape handling as `VerificationError`

### B) Strengthen Phase 3 validator tests (`quality-validator`)

1. Add tolerance-boundary tests:
   - exact boundary values accepted
   - just-outside values rejected

2. Add issue-combination and retry-policy tests:
   - `invalid_output_shape` combined with other issues forces `shouldRetry=false`
   - retryable-only issue sets preserve `shouldRetry=true`

3. Add verification-matrix tests:
   - `verification_marked_invalid`
   - `verification_below_threshold`
   - both conditions together

4. Add meta-text false-positive safety tests:
   - poetic lines that include "here is" without meta-intent should not trigger `contains_meta_text`.

### C) Validation Commands

Run targeted package tests after updates:

```bash
CI=true pnpm --filter @sanctuary/ai-gen test
```

## Acceptance Criteria

- [x] Phase 2 tests fail if request payload contracts drift from implementation plan requirements.
- [x] Phase 2 tests fail on malformed/invalid API outputs not conforming to expected schema.
- [x] Phase 3 tests explicitly cover tolerance boundaries and retry-policy behavior.
- [x] Phase 3 tests include meta-text false-positive guard cases.
- [x] `CI=true pnpm --filter @sanctuary/ai-gen test` passes with the strengthened suite.

## Resolution

### Implemented Changes

- [x] Hardened `packages/ai-gen/src/prompt-builder.test.ts` with exact contract assertions for tolerance text, JSON-only output format, escaped newline semantics, and optional original-poem-title context behavior.
- [x] Hardened `packages/ai-gen/src/gemini-client.test.ts` with strict request payload assertions for default model/temperature, JSON mode/schema wiring, optional field gating, and expanded malformed-response/provider-failure paths.
- [x] Hardened `packages/ai-gen/src/verification-agent.test.ts` with strict request payload assertions (default model, override behavior, prompt propagation, JSON config/schema) plus malformed-response/provider-failure paths.
- [x] Hardened `packages/ai-gen/src/quality-validator.test.ts` with tolerance boundary checks, issue-combination and retry-policy matrix checks, verification condition matrix checks, and meta-text false-positive guard checks.
- [x] Removed stale test model inconsistency by replacing the remaining `gemini-2.0-flash-preview` reference with `gemini-3-flash-preview` in `packages/ai-gen/src/gemini-client.test.ts`.

### Verification

- Executed: `CI=true pnpm --filter @sanctuary/ai-gen test`
- Result: pass (`37 pass`, `0 fail`)

### Commits

- `8e4f6cf` — `test(ai-gen): harden phase 2-3 regression suite`
- `4a45e61` — `test(ai-gen): align model string with phase 2 spec`
