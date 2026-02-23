# Specification: Phase 4 - AI Poem Generation Service

## Overview

This track implements the AI poem generation service as defined in Phase 4 of the data pipeline plan. It replaces the original Claude model requirement with Google's `gemini-3-flash-preview` model. The service will generate synthetic counterpart poems for human poems currently in the database to assemble the daily duels.

## Functional Requirements

1. **Package Setup:**
   - Scaffold a new workspace package `packages/ai-gen`.
   - Install necessary dependencies for interacting with the Google Gemini API (e.g., `@google/genai`).
2. **Generation Logic:**
   - Fetch human poems lacking an AI counterpart from the database.
   - Build custom prompts using the specified topic and line count constraints.
   - Call the `gemini-3-flash-preview` API to generate the synthetic poem.
3. **Quality Validation:**
   - **Line Count Check:** Generated poem must have ≥ 4 lines and be within ±20% of the original poem's line count.
   - **No Meta-Text:** Reject generated text that contains conversational filler or AI artifacts (e.g., "Here is a poem").
4. **Data Persistence:**
   - Insert validated generated poems into the `poems` table with `type = 'AI'`, `author = 'gemini-3-flash-preview'`, the actual `prompt` used, and `parent_poem_id` linking to the human counterpart.
5. **CLI Interface:**
   - Implement a CLI to orchestrate generation.
   - Primary default behavior: Generate counterparts for **ALL** unmatched human poems.
   - Allow optional flags like `--topic <name>` or `--limit <number>`.

## Non-Functional Requirements

- **Rate Limiting:** Implement polite delays between API calls and batch processing to stay within Gemini API rate limits.
- **Idempotency:** The generation process should be resumable. If it fails midway, running it again should only process unmatched poems.
- **Cost Efficiency:** Use the specified Flash Preview model to optimize token usage.

## Configuration & Setup

- Implement specific Gemini API configurations, custom system prompts, and custom workflow rules as provided by the user documentation during implementation.

## Out of Scope

- Frontend UI changes or Duel Assembly logic (this is Phase 5).
