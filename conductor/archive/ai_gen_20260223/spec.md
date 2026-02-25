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
   - Ensure the API call uses `responseMimeType: "application/json"` to generate structured JSON output.
   - Define a `responseSchema` for structured output adherence.
   - Configure Gemini 3 specific parameters: maintain `temperature: 1.0` (optimal for reasoning) and utilize `thinkingConfig` (e.g., `thinking_level: "high"`) if complex generation logic is required.
   - Utilize `systemInstruction` in the `GenerateContentConfig` to establish the correct persona and behavior guidelines (defined via a custom Markdown file prompt).
3. **Quality Validation:**
   - **Verification Agent (Secondary Call):** After the initial poem generation, run a secondary call acting as a "Poem Verification Agent" to verify the contents of the generated poem. Pass the returned `Thought Signatures` to maintain reasoning context.
   - **Line Count Check:** Generated poem must have ≥ 4 lines and be within ±20% of the original poem's line count.
   - **No Meta-Text:** Reject generated text that contains conversational filler or AI artifacts (e.g., "Here is a poem").
4. **Data Persistence:**
   - Transform the generated data from the API call into a format compatible with the database schema.
   - Store the data in the database.
   - Verify that the storage call succeeded.
   - Insert validated generated poems into the `poems` table with `type = 'AI'`, `author = 'gemini-3-flash-preview'`, the actual `prompt` used, and `parent_poem_id` linking to the human counterpart.
5. **Display & Verification:**
   - Display the final stored data.
6. **CLI Interface:**
   - Implement a CLI to orchestrate generation.
   - Primary default behavior: Generate counterparts for **ALL** unmatched human poems.
   - Allow optional flags like `--topic <name>` or `--limit <number>`.
   - The CLI should run as a basic loop with stateful management.

## Non-Functional Requirements

- **Rate Limiting:** Implement polite delays between API calls and batch processing to stay within Gemini API rate limits.
- **Idempotency:** The generation process should be resumable. If it fails midway, running it again should only process unmatched poems.
- **Cost Efficiency:** Use the specified Flash Preview model to optimize token usage.

## Configuration & Setup

- Implement specific Gemini API configurations, custom system prompts (in Markdown files), and custom workflow rules as provided by the user documentation during implementation.
- System instructions must replace line breaks with `\n` if required by JSON formatting, though `@google/genai` handles string inputs natively.

## Out of Scope

- Frontend UI changes or Duel Assembly logic (this is Phase 5).
