# [TASK] Migrate AI Generation from Gemini to DeepSeek

**Date:** 2026-03-01
**Status:** Open
**Priority:** High
**Assignee:** —
**Labels:** `ai-gen`, `deepseek`, `migration`
**Parent:** [`etl-pipeline-activation.md`](etl-pipeline-activation.md)

## Context

The current `@sanctuary/ai-gen` package uses Google's Gemini API (`@google/genai`) for poem generation and verification. During the Phase 3 activation run, the Gemini free tier rate limit (5 RPM for `gemini-3-flash`) caused 43% of wall time to be spent on rate-limit waits, with 429 errors requiring retries. Generating counterparts for all ~362 human poems at this rate would take 2–3 hours.

DeepSeek provides an OpenAI-compatible API with competitive pricing ($0.28/M input tokens, $0.42/M output tokens) and a model (`deepseek-chat`, DeepSeek-V3.2) well-suited for creative writing tasks. The OpenAI SDK can be pointed at DeepSeek's base URL with no other changes to the call shape.

## API Reference

- **Base URL:** `https://api.deepseek.com/v1`
- **Auth:** Bearer token via `DEEPSEEK_API_KEY`
- **Primary model:** `deepseek-chat` (DeepSeek-V3.2, 128K context, 8K max output)
- **SDK:** `openai` npm package with `baseURL` and `apiKey` overrides
- **Docs:** https://api-docs.deepseek.com/

### OpenAI SDK usage

```typescript
import OpenAI from 'openai';

// Singleton instance to preserve TCP connection pooling
const client = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
  timeout: 30000, // Explicit timeout to prevent hanging
  maxRetries: 2,  // Let SDK handle network retries (429, 5xx)
});

const response = await client.chat.completions.create({
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: systemPrompt },
    // Ensure "JSON" is mentioned in user prompt for json_object format
    { role: 'user', content: userPrompt + '\nRespond in JSON format.' },
  ],
  response_format: { type: 'json_object' }, // for structured output
  temperature: 0.8,
});

const content = response.choices[0]?.message?.content;
```

## Required Changes

### 1. Add `openai` dependency, remove `@google/genai`

**`packages/ai-gen/package.json`:**

```diff
 "dependencies": {
-  "@google/genai": "^1.4.0",
+  "openai": "^4.x",
   "@sanctuary/db": "workspace:*",
```

Run `pnpm install` from the repo root after updating.

### 2. Replace `packages/ai-gen/src/gemini-client.ts` with `src/deepseek-client.ts`

This file wraps the Gemini SDK. Replace it with a DeepSeek client using the `openai` package.
- **Rename** the file to `deepseek-client.ts` (or `ai-client.ts`) to avoid confusion.
- **Singleton Client:** Instantiate `OpenAI` once and export it or the wrapping functions, preventing an anti-pattern of creating a new client on every call.
- **Resilience:** Add `timeout: 30000` to the client instantiation.
- **Interface Updates:** 
  - Keep `GeneratePoemParams` shape but remove `thinkingConfig` (not supported by this API).
  - Map `maxOutputTokens` to `max_tokens` (or `max_completion_tokens`).
  - Keep `PoemOutput` and `PoemGenerationError`.
  - Update default model constant: `const DEFAULT_MODEL = 'deepseek-chat'`.
- **JSON Parsing & Sanitization:** DeepSeek may wrap JSON in Markdown code blocks (e.g., ` ```json ... ``` `). Strip these fences and trim the string before calling `JSON.parse()` to avoid `SyntaxError`.

### 3. Replace `packages/ai-gen/src/verification-agent.ts`

Same pattern as the generation client. Use the shared OpenAI singleton instance, update the model to `deepseek-chat`, use `response_format: { type: 'json_object' }`, and apply the same JSON string sanitization before parsing.

### 4. Update environment variables

**Root `.env` and `packages/ai-gen/.env`:** Add `DEEPSEEK_API_KEY`. Remove or leave `GEMINI_API_KEY` as a dead key (harmless).

**`packages/ai-gen/src/index.ts` — `resolveApiKey`:**

```typescript
function resolveApiKey(env: NodeJS.ProcessEnv): string {
  const apiKey = env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('Missing DeepSeek API key. Set DEEPSEEK_API_KEY.');
  }
  return apiKey;
}
```

### 5. Update CLI default model and Rate Limiter

**`packages/ai-gen/src/cli.ts`:**

- Update `DEFAULT_MODEL` to `'deepseek-chat'`.
- **Rate Limiter:** DeepSeek's limits are much higher than Gemini's 5 RPM. The existing `RateLimiter` (with a hardcoded 60s sliding window) should be bypassed or disabled. Let the `--concurrency` flag and the OpenAI SDK's native 429 retry backoff govern throughput naturally to avoid unnecessary local throttling.
- **Retry Logic:** Delineate SDK retries (network-level, handled by OpenAI) from CLI retries (application-level parsing or quality failures, handled by `generation-service.ts`).

## Recommended Generation Algorithm

1. **Client Initialization:** Instantiate the `OpenAI` client once globally with configured `baseURL`, `apiKey`, `timeout` (e.g., 30s), and `maxRetries` (to handle network blips).
2. **Rate Control Gate:** Bypass the manual 60s sliding-window rate limiter. Rely on the CLI `--concurrency` flag and native API rate limits.
3. **Prompt Construction:** Verify the `messages` array contains the explicit word "JSON" (required by the OpenAI SDK when using `json_object` format).
4. **API Execution:** Call `client.chat.completions.create` with `response_format: { type: 'json_object' }`.
5. **Response Sanitization:** Extract the content string. Run a Regex filter to strip standard markdown formatting (e.g., ` ```json ` and ` ``` `) and trailing whitespace from the string.
6. **Validation & Parsing:** Attempt `JSON.parse()`. If a `SyntaxError` is thrown, map it to a custom `PoemGenerationError` and let the application retry loop handle the fallback.

## Files to Modify

| File | Change |
|------|--------|
| `packages/ai-gen/package.json` | Replace `@google/genai` with `openai` |
| `packages/ai-gen/src/gemini-client.ts` | Rename to `deepseek-client.ts`, rewrite with OpenAI SDK, singleton, timeouts, and JSON sanitization |
| `packages/ai-gen/src/verification-agent.ts` | Rewrite using shared OpenAI SDK singleton, JSON sanitization |
| `packages/ai-gen/src/generation-service.ts`| Update imports to point to `deepseek-client.ts` |
| `packages/ai-gen/src/index.ts` | Update `resolveApiKey` to read `DEEPSEEK_API_KEY`, update exports |
| `packages/ai-gen/src/cli.ts` | Update `DEFAULT_MODEL`, disable manual `RateLimiter` |
| `packages/ai-gen/.env` | Add `DEEPSEEK_API_KEY`, remove `GEMINI_API_KEY` |
| Root `.env` | Add `DEEPSEEK_API_KEY` |

## Acceptance Criteria

- [ ] `pnpm --filter @sanctuary/ai-gen run generate --limit 5 --concurrency 3` completes with 5/5 poems stored using DeepSeek
- [ ] No references to `@google/genai` remain in `packages/ai-gen/src/`
- [ ] `GEMINI_API_KEY` is no longer required to run generation
- [ ] Manual rate limiter is bypassed, allowing concurrent generation limited by DeepSeek's limits
- [ ] API calls do not hang indefinitely (timeouts are active)
- [ ] Full generation run (`--concurrency 3`) completes and duel assembly produces duels