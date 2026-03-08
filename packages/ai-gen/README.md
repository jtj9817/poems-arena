# @sanctuary/ai-gen

AI poem generation service for Poem Arena.

This package generates AI counterparts for HUMAN poems in the `poems` table using DeepSeek (`deepseek-chat`), validates quality, and persists idempotent AI rows linked by `parent_poem_id`.

## Features

- Selects unmatched HUMAN poems from the database (`type='HUMAN'` with no AI counterpart).
- Builds topic-aware prompts with line-count targeting (±20% tolerance).
- Uses DeepSeek JSON mode with response schema enforcement (`title`, `content`).
- Runs a secondary DeepSeek verification pass and quality validation checks.
- Persists AI poems with deterministic IDs for idempotency.
- Includes a CLI with topic, limit, model, concurrency, and retry controls.

## Prerequisites

- Bun installed
- Workspace dependencies installed (`pnpm install` at repo root)
- Database schema includes AI-generation fields on `poems`; `topics`/`poem_topics` are only required when using `--topic`

## Environment Variables

| Variable                 | Required           | Description                                            |
| ------------------------ | ------------------ | ------------------------------------------------------ |
| `LIBSQL_URL`             | Yes (outside test) | LibSQL/Turso connection URL for `@sanctuary/db`        |
| `LIBSQL_AUTH_TOKEN`      | Optional           | LibSQL auth token                                      |
| `DEEPSEEK_API_KEY`       | Yes                | DeepSeek API key                                       |
| `LIBSQL_TEST_URL`        | Test only          | Test DB URL when `NODE_ENV=test`                       |
| `LIBSQL_TEST_AUTH_TOKEN` | Test only          | Optional test DB auth token                            |

## CLI Usage

Run from repository root:

```bash
pnpm --filter @sanctuary/ai-gen run generate
```

Equivalent commands:

```bash
pnpm --filter @sanctuary/ai-gen run start
pnpm --filter @sanctuary/ai-gen run dev
```

### Options

| Flag            | Type             | Default                  | Description                                               |
| --------------- | ---------------- | ------------------------ | --------------------------------------------------------- |
| `--topic`       | string           | auto/default             | Restrict candidate selection to a topic ID or topic label |
| `--limit`       | positive integer | all unmatched            | Maximum number of HUMAN poems to process                  |
| `--model`       | string           | `deepseek-chat`          | DeepSeek model name used for generation + verification    |
| `--concurrency` | positive integer | `3`                      | Max concurrent poem generation tasks                      |
| `--max-retries` | positive integer | `2`                      | Retry attempts after retryable validation failures        |

Examples:

```bash
# Process all unmatched HUMAN poems
pnpm --filter @sanctuary/ai-gen run generate

# Restrict to a topic
pnpm --filter @sanctuary/ai-gen run generate --topic nature

# Process first 50 matching poems
pnpm --filter @sanctuary/ai-gen run generate --topic mortality --limit 50

# Override model and runtime controls
pnpm --filter @sanctuary/ai-gen run generate --model deepseek-chat --concurrency 5 --max-retries 3
```

## Runtime Behavior

1. Fetch unmatched HUMAN poem candidates.
2. Build prompt with target line count and optional parent title context.
3. Generate JSON poem output via DeepSeek (`title`, `content`).
4. Verify generated poem with a second DeepSeek call.
5. Validate quality rules:
   - Minimum 4 non-empty lines
   - Within ±20% of parent poem line count
   - No meta-text artifacts
   - Verification score threshold and validity checks
6. Persist AI poem row with deterministic ID and `parent_poem_id` linkage.

## Prompting

- System instructions file: `packages/ai-gen/prompts/system-instructions.md`
- Prompt builder module: `packages/ai-gen/src/prompt-builder.ts`
- Project-level prompt documentation: `docs/backend/ai-gen-prompts.md`

## Testing

```bash
pnpm --filter @sanctuary/ai-gen test
```
