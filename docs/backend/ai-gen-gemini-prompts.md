# AI Generation Prompts (Gemini)

This document captures the production prompt contracts used by `@sanctuary/ai-gen` for Phase 4 AI poem generation.

## Prompt Components

### 1. System Instructions (Generation)

- Source file: `packages/ai-gen/prompts/system-instructions.md`
- Loaded by: `packages/ai-gen/src/prompt-builder.ts` (`loadSystemInstructions`)
- Role: establish model persona and hard output constraints.

Core requirements in the generation system prompt:

- Creative poet persona grounded in classical literary influence
- Human-sounding poetic output with concrete imagery
- No AI/meta phrasing (for example, "Here is a poem")
- JSON-only output contract:
  - `title` (string)
  - `content` (string with `\\n` line breaks)

### 2. User Prompt Template (Generation)

Built in `packages/ai-gen/src/prompt-builder.ts` (`buildPrompt`).

The prompt includes:

- Topic directive (`Write an original poem about "{topic}"`)
- Line count bounds derived from parent poem line count (±20%)
- Formatting constraint to return valid JSON only
- Stylistic constraints (literary voice, concrete imagery, avoid clichés)
- Optional contextual reference to parent poem title

### 3. Verification Prompt + System Instruction

- Module: `packages/ai-gen/src/verification-agent.ts`
- Model: `gemini-3-flash-preview` (default)

Verification system instruction defines rubric categories:

- Literary quality
- Originality
- Emotional resonance
- Technical skill

Verification response contract (JSON-only):

```json
{
  "isValid": true,
  "score": 85,
  "feedback": "brief constructive feedback"
}
```

## Gemini API Configuration Notes

Generation and verification calls both enforce structured JSON output via:

- `responseMimeType: "application/json"`
- `responseSchema` objects in code

Generation defaults:

- Model: `gemini-3-flash-preview`
- Temperature: `1.0`
- Optional `thinkingConfig` and `maxOutputTokens` support in the client wrapper

## Quality Guardrail Linkage

Prompting works in tandem with `packages/ai-gen/src/quality-validator.ts`, which rejects responses that violate runtime quality rules:

- Invalid output shape
- Fewer than 4 lines
- Line count outside ±20% tolerance
- Meta-text artifacts
- Verification invalidation / low score
