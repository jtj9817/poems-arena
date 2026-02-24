# Implementation Plan: Phase 4 - AI Poem Generation Service

## Phase 1: Setup `packages/ai-gen` Package [checkpoint: 71db327]

- [x] Task: Scaffold `packages/ai-gen` workspace [107e563]
  - [x] Initialize `package.json`, `tsconfig.json`, and set up testing environment (e.g., test runner).
  - [x] Add dependencies for Google Gemini API (`@google/genai`) and rate limiting (`p-limit`).
- [x] Task: Conductor - User Manual Verification 'Phase 1: Setup packages/ai-gen Package' (Protocol in workflow.md) [4dacab8]

## Phase 2: Generation Logic and Prompts [checkpoint: 8508407]

- [x] Task: Create custom prompt builder
  - [x] Write failing test for generating prompts based on a provided topic and target line count.
  - [x] Implement prompt builder logic based on the user-provided Gemini configs/prompts.
  - [x] Configure `System Instructions` using a custom Markdown file.
- [x] Task: Implement Gemini API Client
  - [x] Write failing test for the API wrapper (mocking the `gemini-3-flash-preview` API response).
  - [x] Implement the `gemini-3-flash-preview` API wrapper using `@google/genai`.
  - [x] Configure the API call to utilize `JSON Mode` (`responseMimeType: "application/json"`), `responseSchema`, and Gemini 3 specific settings (e.g., `temperature: 1.0`, `thinkingConfig`).
- [x] Task: Implement Poem Verification Agent
  - [x] Implement a secondary API call logic to verify the contents of the generated poem, potentially utilizing `Thought Signatures` to maintain context.
- [x] Task: Conductor - User Manual Verification 'Phase 2: Generation Logic and Prompts' (Protocol in workflow.md)

## Phase 3: Validation and Quality Checks

- [x] Task: Implement Quality Validator
  - [x] Write failing tests for validation logic (minimum 4 lines, ±20% length of the parent poem, rejecting meta-text).
  - [x] Implement the `Line Count Check` logic to reject/retry mismatched lengths.
  - [x] Implement the `No Meta-Text` check to reject generic AI conversational fillers.
- [~] Task: Conductor - User Manual Verification 'Phase 3: Validation and Quality Checks' (Protocol in workflow.md)

## Phase 4: Database Integration and CLI

- [ ] Task: Orchestrate Data Persistence
  - [ ] Write failing test for transforming API JSON data into the database schema and inserting generated poems.
  - [ ] Implement Drizzle ORM queries to fetch unmatched human poems, transform the verified API output, and insert new AI counterparts.
  - [ ] Verify that the database storage call succeeded.
  - [ ] Display the data.
- [ ] Task: Implement the CLI interface
  - [ ] Write failing test for CLI parsing, batch orchestration, stateful management, and display.
  - [ ] Implement the CLI entry point (`src/index.ts`) as a basic loop with stateful management, defaulting to processing all unmatched poems.
  - [ ] Add rate limiting using `p-limit` to handle batch generation efficiently.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Database Integration and CLI' (Protocol in workflow.md)

## Phase 5: Regression & Quality Gate

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute `pnpm --filter @sanctuary/ai-gen test` to ensure tests pass and coverage is >80%.
  - [ ] Execute `pnpm lint`.
  - [ ] Execute `pnpm format:check` (or `pnpm format` to fix).
- [ ] Task: Regression Checklist (Feature Behaviors)
  - [ ] Verify that running the CLI processes a batch of human poems and generates corresponding AI poems.
  - [ ] Verify that rerunning the CLI does not duplicate existing AI counterparts (idempotency).
  - [ ] Verify validation successfully catches and rejects non-conforming responses.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 6: Documentation

- [ ] Task: Documentation Update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 4 completion with Gemini instead of Claude.
  - [ ] Create `packages/ai-gen/README.md` with CLI usage instructions and configuration details.
  - [ ] Document the Gemini system prompts in the project documentation.
- [ ] Task: Conductor - User Manual Verification 'Phase 6: Documentation' (Protocol in workflow.md)

## Phase: Review Fixes

- [x] Task: Apply review suggestions [e186e38]
