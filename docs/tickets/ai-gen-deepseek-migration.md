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
  temperature: 1.5, // DeepSeek recommends 1.5 for creative writing / poetry
  max_tokens: 2048, // Required: prevents JSON string from being cut off mid-output
});

const content = response.choices[0]?.message?.content;
```

### JSON Output

Requirements when using `response_format: { type: 'json_object' }`:

1. The word **"json"** must appear literally in the system or user prompt. Include a brief example of the expected JSON schema to improve output fidelity.
2. Set **`max_tokens`** explicitly to a safe ceiling (e.g., `2048`) to prevent the response from being cut off mid-JSON, which would cause a `SyntaxError` on parse.
3. **Empty content warning:** The API may occasionally return an empty string with JSON Output enabled. Detect `!content` before `JSON.parse()` and retry with a rephrased or expanded prompt.
4. **Markdown fence stripping:** Despite `json_object` mode, the model may wrap output in ` ```json ... ``` ` fences. Strip these with a regex before parsing.

**Alternative — Chat Prefix Completion (Beta):** Using `baseURL: 'https://api.deepseek.com/beta'` and supplying a trailing `{ role: 'assistant', content: '{', prefix: true }` message forces the model to begin its response directly with `{`, eliminating fence wrapping entirely. This is a beta feature requiring a separate `baseURL` from the production client.

### Models & Pricing

| Model | Version | Context | Default Max Output | Maximum Max Output |
|---|---|---|---|---|
| `deepseek-chat` | DeepSeek-V3.2 (Non-thinking Mode) | 128K | 4K | 8K |
| `deepseek-reasoner` | DeepSeek-V3.2 (Thinking Mode) | 128K | 32K | 64K |

**Pricing for `deepseek-chat` (per 1M tokens):**

| Token Type | Price |
|---|---|
| Input (cache miss) | $0.28 |
| Input (cache hit) | $0.028 |
| Output | $0.42 |

> Prices may change. Check [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) for current rates. Both models support JSON output and tool calls; `deepseek-reasoner` does not support FIM completion.

### Rate Limit

DeepSeek does not enforce a hard static rate limit, but per the FAQ, each account has a **dynamic rate limit** adjusted in real time based on server traffic pressure and the account's recent usage history. This limit cannot be manually increased. 429 errors can and do occur during high-traffic periods — the OpenAI SDK's `maxRetries` handles these automatically.

Under high server load, the connection is kept alive while the server queues the request:
- **Non-streaming requests:** server returns empty lines.
- **Streaming requests:** server returns SSE keep-alive comments (`: keep-alive`).

The OpenAI SDK handles these transparently. If parsing raw HTTP responses manually, filter empty lines and `: keep-alive` comments before JSON parsing.

> If inference has not started within **10 minutes**, the server closes the connection.

### Error Codes

| Code | Name | Cause | Solution |
|---|---|---|---|
| 400 | Invalid Format | Malformed request body | Fix request body per error message hints |
| 401 | Authentication Fails | Wrong or missing API key | Verify `DEEPSEEK_API_KEY` is set correctly |
| 402 | Insufficient Balance | Account balance exhausted | Top up at platform.deepseek.com |
| 422 | Invalid Parameters | Invalid parameter values | Adjust parameters per error message hints |
| 429 | Rate Limit Reached | Requests sent too quickly | Back off; OpenAI SDK `maxRetries` handles this |
| 500 | Server Error | Internal server issue | Retry after a brief wait; contact support if persistent |
| 503 | Server Overloaded | High traffic | Retry after a brief wait |

The OpenAI SDK (`maxRetries: 2`) retries 429 and 5xx responses automatically. Application-level retry logic should only cover quality or JSON parse failures, not network-level errors.

### The Temperature Parameter

Default: `1.0`. Range: `0–2`. DeepSeek's recommended settings by use case:

| Use Case | Temperature |
|---|---|
| Coding / Math | 0.0 |
| Data Cleaning / Analysis | 1.0 |
| General Conversation | 1.3 |
| Translation | 1.3 |
| **Creative Writing / Poetry** | **1.5** |

For poem generation in this project, use `temperature: 1.5`. Alter `temperature` or `top_p` but not both.

### Context Caching

Context caching is **enabled by default** for all users — no code changes required. DeepSeek stores request prefixes on disk; if a subsequent request shares the same leading prefix, those tokens are served from cache at the **cache-hit rate ($0.028/M)** instead of the standard rate ($0.28/M) — a **10× cost reduction**.

**What qualifies as a prefix:** Only the *shared leading portion* of the `messages` array triggers a cache hit. For poem generation, if every call uses the same system prompt text, the system message tokens will be cache-hit on all calls after the first.

**Key constraints:**
- Minimum cache unit: **64 tokens** — prefixes shorter than 64 tokens are never cached.
- Cache construction takes a few seconds on the first request.
- Cache entries are cleared after a few hours to a few days of inactivity. Hit rate is best-effort (not 100% guaranteed).

**Usage fields in the response:**
- `usage.prompt_cache_hit_tokens` — input tokens served from cache (billed at $0.028/M).
- `usage.prompt_cache_miss_tokens` — input tokens processed fresh (billed at $0.28/M).

**Implication for bulk generation:** Keep the system prompt text identical across all generation calls. For a 362-poem run, only the first call pays full input price on the system prompt; all subsequent calls cache-hit it, reducing prompt input costs by ~90%.

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
- **JSON Parsing & Sanitization:** DeepSeek may wrap JSON in Markdown code blocks (e.g., ` ```json ... ``` `) even with `json_object` mode. Strip these fences and trim the string before calling `JSON.parse()`. Also guard against the API occasionally returning an empty string — check `!content` before parsing and treat it as a retryable failure.
- **`max_tokens`:** Set `max_tokens: 2048` (or appropriate ceiling) on every `json_object` call to prevent truncated JSON that causes parse errors.

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