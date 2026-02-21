# Implementation Plan - Phase 3: ETL Pipeline

## Phase 1: Setup & Data Access Layer

- [ ] Task: Scaffold `packages/etl` package
  - [ ] Create `packages/etl` directory with `package.json` and `tsconfig.json`.
  - [ ] Install dependencies: `drizzle-orm`, `@libsql/client`, `zod`, `fast-glob`, `dotenv`.
  - [ ] Add `packages/etl` to `pnpm-workspace.yaml` (if not already implicitly included).
- [ ] Task: Shared Schema Access
  - [ ] Refactor/Move Drizzle schema from `apps/api` to `packages/shared` (or `packages/db` if appropriate) so it can be used by both API and ETL.
  - [ ] Update `apps/api` to import schema from the shared location.
  - [ ] Configure `packages/etl` to import the shared schema.
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Setup & Data Access Layer' (Protocol in workflow.md)

## Phase 2: Extract & Transform Stages

- [ ] Task: Implement Clean Stage (`01-clean.ts`)
  - [ ] Create `src/stages/01-clean.test.ts`: Test whitespace normalization, HTML stripping, and validation logic.
  - [ ] Implement `src/stages/01-clean.ts`: Read raw JSON, process, and output cleaned JSON.
- [ ] Task: Implement Deduplicate Stage (`02-dedup.ts`)
  - [ ] Create `src/stages/02-dedup.test.ts`: Test grouping by title/author and source priority resolution.
  - [ ] Implement `src/stages/02-dedup.ts`: Read cleaned JSON, deduplicate, and output.
- [ ] Task: Implement Tag Stage (`03-tag.ts`)
  - [ ] Create `src/stages/03-tag.test.ts`: Test theme mapping and keyword fallback logic.
  - [ ] Implement `src/stages/03-tag.ts`: Map themes to `CANONICAL_TOPICS`, apply fallback, output tagged JSON.
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Extract & Transform Stages' (Protocol in workflow.md)

## Phase 3: Load Stage & CLI Orchestration

- [ ] Task: Implement Load Stage (`04-load.ts`)
  - [ ] Create `src/stages/04-load.test.ts`: Mock DB and test upsert logic for Topics, Poems, and Associations.
  - [ ] Implement `src/stages/04-load.ts`: Transactional bulk upsert using Drizzle.
- [ ] Task: Implement CLI Entry Point
  - [ ] Implement `src/index.ts`: CLI with flags (e.g., `--stage`, `--dry-run`).
  - [ ] Add `pipeline` script to `packages/etl/package.json`.
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Load Stage & CLI Orchestration' (Protocol in workflow.md)

## Phase 4: Regression & Quality Gate

- [ ] Task: Coverage and Regression Verification
  - [ ] Execute `pnpm --filter @sanctuary/etl test` and ensure all tests pass.
  - [ ] Execute `pnpm lint` and `pnpm format:check`.
- [ ] Task: Regression Checklist
  - [ ] Verify that re-running the pipeline is idempotent (no duplicates).
  - [ ] Verify that source priority is respected (Poets.org > Gutenberg).
  - [ ] Verify that keyword fallback assigns topics to untagged poems.
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Regression & Quality Gate' (Protocol in workflow.md)

## Phase 5: Documentation

- [ ] Task: Documentation Update
  - [ ] Update `docs/plans/001-data-pipeline-plan.md` to reflect Phase 3 completion.
  - [ ] Add `packages/etl/README.md` with usage instructions.
  - [ ] Update project `README.md` to include ETL pipeline commands.
