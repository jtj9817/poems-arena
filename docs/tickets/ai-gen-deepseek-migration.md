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

const client = new OpenAI({
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'deepseek-chat',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
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

### 2. Replace `packages/ai-gen/src/gemini-client.ts`

This file wraps the Gemini SDK. Replace it with a DeepSeek client using the `openai` package. The exported interface must remain compatible with existing callers in `generation-service.ts`:

- Keep the `GeneratePoemParams` shape (poem content, system instructions, model, apiKey)
- Keep the `PoemOutput` shape (`{ title: string; content: string }`)
- Keep the `PoemGenerationError` class
- Replace the `GoogleGenAI` client instantiation and call with the OpenAI SDK equivalent
- Update the default model constant: `const DEFAULT_MODEL = 'deepseek-chat'`

The Gemini API used `responseSchema` for structured JSON output. With DeepSeek/OpenAI SDK, use `response_format: { type: 'json_object' }` and parse the response manually against the expected shape.

### 3. Replace `packages/ai-gen/src/verification-agent.ts`

Same pattern as `gemini-client.ts`. Replace `GoogleGenAI` with the `openai` package, update the model to `deepseek-chat`, and use `response_format: { type: 'json_object' }` for the verification JSON response.

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

### 5. Update CLI default model

**`packages/ai-gen/src/cli.ts`:**

```typescript
const DEFAULT_MODEL = 'deepseek-chat';
```

### 6. Update rate limiter (adjust RPM if needed)

DeepSeek's rate limits differ from Gemini's free tier. Consult the DeepSeek platform dashboard for the account's RPM limit. Update the rate limiter in `cli.ts` accordingly. The sliding-window implementation already supports changing the RPM cap — only the constant needs updating.

## Files to Modify

| File | Change |
|------|--------|
| `packages/ai-gen/package.json` | Replace `@google/genai` with `openai` |
| `packages/ai-gen/src/gemini-client.ts` | Rewrite using OpenAI SDK pointing at DeepSeek |
| `packages/ai-gen/src/verification-agent.ts` | Rewrite using OpenAI SDK pointing at DeepSeek |
| `packages/ai-gen/src/index.ts` | Update `resolveApiKey` to read `DEEPSEEK_API_KEY` |
| `packages/ai-gen/src/cli.ts` | Update `DEFAULT_MODEL` to `deepseek-chat`; adjust RPM cap |
| `packages/ai-gen/.env` | Add `DEEPSEEK_API_KEY`, remove `GEMINI_API_KEY` |
| Root `.env` | Add `DEEPSEEK_API_KEY` |

## Acceptance Criteria

- [ ] `pnpm --filter @sanctuary/ai-gen run generate --limit 5 --concurrency 3` completes with 5/5 poems stored using DeepSeek
- [ ] No references to `@google/genai` remain in `packages/ai-gen/src/`
- [ ] `GEMINI_API_KEY` is no longer required to run generation
- [ ] Rate limiter RPM cap is updated to match the DeepSeek account's actual limit
- [ ] Full generation run (`--concurrency 3`) completes and duel assembly produces duels
