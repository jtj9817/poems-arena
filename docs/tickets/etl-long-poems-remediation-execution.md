# ETL-LONG-POEMS-REMEDIATION-EXECUTION

**Status:** OPEN  
**Priority:** High  
**Created:** 2026-03-04  
**Owner:** Data Pipeline / ETL  
**Related Ticket:** `fix-long-poems.md`

---

## Summary

After LOC-180 duplicate cleanup, AI generation is healthy overall but consistently leaves 6 unmatched HUMAN poems. Analysis confirms **5 of those 6 are valid long-form poems** that repeatedly fail generation due to oversized line-count targets and JSON truncation behavior. This ticket defines a controlled remediation plan for those 5 specific records.

## Background / Current State

- LOC duplicate cleanup already completed (64 stale long-format LOC records removed; poem-002 intentionally retained as long-format singleton).
- Current DB validation snapshot:
  - `HUMAN = 503`
  - `AI = 563`
  - `LOC HUMAN = 179`
  - `Unmatched HUMAN = 6`
- Failure pattern across multiple generation runs is stable for these long poems:
  - `Failed to generate poem: JSON Parse error: Unterminated string`
  - `line_count_out_of_range`
- Root technical pressure:
  - parent line count directly drives generation target (`packages/ai-gen/src/generation-service.ts`)
  - strict ±20% line window (`packages/ai-gen/src/prompt-builder.ts`, `packages/ai-gen/src/quality-validator.ts`)
  - model output ceiling (`max_tokens=2048` in `packages/ai-gen/src/deepseek-client.ts`)

## Scope (Target Records)

Remediate the following **5 valid long poems** (exact DB `poems.id` values):

| poems.id | Title | Author | Source | Approx lines |
|---|---|---|---|---|
| `19176bc9d632` | The Ballad of Reading Gaol | Oscar Wilde | poets.org | 660 |
| `b45e1e960ad8` | MAY-DAY | Ralph Waldo Emerson | gutenberg | 523 |
| `92273a10aba0` | MONADNOC | Ralph Waldo Emerson | gutenberg | 408 |
| `c8d1c4ef3331` | THE ADIRONDACS | Ralph Waldo Emerson | gutenberg | 351 |
| `f399fdc5e1ab` | FRAGMENTS ON THE POET AND THE POETIC GIFT | Ralph Waldo Emerson | gutenberg | 321 |

Out-of-scope for this ticket: `d87091e153a9` (`INDEX OF FIRST LINES`, non-poem artefact) except compatibility notes where needed.

## Objective

Enable successful AI counterpart generation for the 5 records above while preserving data integrity, reproducibility, and traceability.

## Execution Plan

1. **Pre-flight snapshot (mandatory)**
   - Export point-in-time rows for:
     - `poems` for the 5 IDs
     - related `poem_topics`, `scrape_sources`, `duels`, `votes`, `featured_duels`
   - Record baseline counts (`poems by type`, `unmatched HUMAN`, `duels`, `votes`).

2. **Dry-run script verification**
   - Run:
     - `pnpm --filter @sanctuary/etl run fix-long-poems -- --dry-run`
   - Confirm:
     - only intended 5 split targets are touched for this execution window
     - expected split part sizes/line counts look sane
     - no unexpected missing records.

3. **Targeted live remediation**
   - Preferred: execute script logic in a controlled run for the 5 IDs above.
   - Ensure LLM structural verification passes for each split part.
   - Preserve poem metadata (`author`, `source`, `source_url`, `year`, topics, scrape source lineage).

4. **Post-remediation generation**
   - Re-run:
     - `bun scripts/run-generate.ts --concurrency 3`
   - Monitor `logs/generate-status.json` until complete.

5. **Validation + signoff**
   - Verify:
     - the 5 original long IDs are replaced/handled per strategy
     - AI counterparts now exist for the remediated HUMAN records
     - `Unmatched HUMAN` decreases accordingly
     - no unintended regression in `duels`, `votes`, `featured_duels`.

## Precautions / Safety Requirements

- **No concurrent ETL + AI generation** against same DB.
- **Run dry-run first**, always.
- **Single-operator window**: avoid other write jobs while remediation runs.
- **ID-level guardrails**: execute only against the 5 IDs listed in scope.
- **Cascade awareness**: any delete+reinsert flow may remove related duel/vote chains tied to original IDs; quantify this impact before live run.
- **Reproducibility**: log command lines, run timestamps, and resulting counts in ticket comments.
- **Rollback readiness**: keep pre-flight snapshot artifacts before applying mutations.

## Acceptance Criteria

- [ ] All 5 scoped poem IDs are remediated without orphaning related records.
- [ ] AI generation succeeds for remediated poems (or fails only with new, documented reasons).
- [ ] `Unmatched HUMAN` is reduced from the current baseline of 6.
- [ ] No unplanned deletions outside scoped IDs.
- [ ] Final validation report captured and linked in ticket update.

## Notes for Decision

- Manual one-off truncation is not recommended (non-reproducible, fidelity loss).
- Scripted remediation is preferred for auditability and repeatability.
- If script behavior includes non-scoped targets, create a temporary scoped variant or guard flag before live execution.
