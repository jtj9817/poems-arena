# ETL-LONG-POEMS-REMEDIATION-EXECUTION

**Status:** OPEN  
**Priority:** High  
**Created:** 2026-03-04  
**Last Validated:** 2026-03-04  
**Owner:** Data Pipeline / ETL  
**Related Ticket:** `fix-long-poems.md`

---

## Summary

Live DB audit on 2026-03-04 shows long-poem remediation is only partially applied in the current dataset:

- Split part-poems exist and have AI counterparts.
- Original long-form rows still exist, remain unmatched, and are still referenced by duels.

This ticket now tracks cleanup/reconciliation needed to remove stale unmatched originals and finish remediation safely.

## Background / Current State

- LOC duplicate cleanup already completed (64 stale long-format LOC records removed; poem-002 intentionally retained as long-format singleton).
- Current DB validation snapshot (2026-03-04):
  - `HUMAN = 503`
  - `AI = 563`
  - `LOC HUMAN = 179`
  - `Unmatched HUMAN = 6`
- Record-level findings from live audit:
  - all 6 unmatched HUMAN rows are legacy originals:  
    `19176bc9d632`, `b45e1e960ad8`, `92273a10aba0`, `c8d1c4ef3331`, `f399fdc5e1ab`, `d87091e153a9`
  - each unmatched original is still duel-referenced (`10` duel refs each; `60` total)
  - split part-poems (`(I)`, `(II)`, etc.) already exist and are healthy:
    - each has `topic_count = 3`
    - each has `source_count = 1`
    - each has an AI counterpart (`has_ai = 1`)
- Integrity checks:
  - `orphanPoemTopics = 0`
  - `orphanScrapeSources = 0`
  - `orphanDuels = 0`
  - `orphanVotes = 0`
  - `orphanFeaturedDuels = 0`
- Seed-data exceptions (expected baseline, not remediation targets):
  - `p1`, `p4` are HUMAN seed rows without scrape sources
  - `p2`, `p3` are AI seed rows without `parent_poem_id`

## Scope (Target Records)

Reconcile the following unmatched originals (exact DB `poems.id` values), based on 2026-03-04 audit:

| poems.id | Title | Current state | Required action |
|---|---|---|---|
| `19176bc9d632` | The Ballad of Reading Gaol | original present + split parts present | remove stale original safely |
| `b45e1e960ad8` | MAY-DAY | original present + split parts present | remove stale original safely |
| `92273a10aba0` | MONADNOC | original present + split parts present | remove stale original safely |
| `c8d1c4ef3331` | THE ADIRONDACS | original present + split parts present | remove stale original safely |
| `f399fdc5e1ab` | FRAGMENTS ON THE POET AND THE POETIC GIFT | original present, unmatched | classify (artefact vs valid poem), then remediate accordingly |
| `d87091e153a9` | INDEX OF FIRST LINES | non-poem artefact still duel-referenced | remove artefact safely |

Note: `d87091e153a9` is now explicitly in-scope because it is still in the unmatched set and still referenced by duels.

## Objective

Eliminate stale unmatched originals and complete long-poem reconciliation while preserving data integrity, reproducibility, and traceability.

## Execution Plan

1. **Pre-flight snapshot (mandatory)**
   - Export point-in-time rows for:
     - `poems` for all 6 scoped IDs above
     - related `poem_topics`, `scrape_sources`, `duels`, `votes`, `featured_duels`
   - Record baseline counts (`poems by type`, `unmatched HUMAN`, `duels`, `votes`) and duel-ref counts per scoped ID.

2. **Dry-run script verification**
   - Run:
     - `pnpm --filter @sanctuary/etl run fix-long-poems -- --dry-run`
   - Confirm:
     - only intended scoped IDs are touched for this execution window
     - expected split part sizes/line counts look sane
     - no unexpected missing records.

3. **Targeted live remediation**
   - For IDs that already have split parts + AI (`19176bc9d632`, `b45e1e960ad8`, `92273a10aba0`, `c8d1c4ef3331`):
     - remove only stale originals and cascade/rebuild dependent duels as needed.
   - For `f399fdc5e1ab`:
     - first classify as non-poem artefact vs valid long poem, then either delete or split+generate.
   - For `d87091e153a9`:
     - remove as non-poem artefact with full cascade safety.
   - Preserve metadata lineage (`author`, `source`, `source_url`, `year`, topics, scrape source lineage) for retained records.

4. **Post-remediation generation**
   - Run generation only if new HUMAN split records are created in step 3:
     - `bun scripts/run-generate.ts --concurrency 3`
   - Monitor `logs/generate-status.json` until complete when generation is executed.

5. **Validation + signoff**
   - Verify:
     - none of the 6 scoped IDs remain in unmatched HUMAN
     - no duels reference stale originals
     - AI counterparts exist for retained/remediated HUMAN records per strategy
     - `Unmatched HUMAN` decreases accordingly
     - no unintended regression in `duels`, `votes`, `featured_duels`.

### SQL Validation Checklist

Run after remediation/generation completes:

```sql
-- 1) Scoped IDs no longer unmatched
SELECT p.id, p.title
FROM poems p
WHERE p.id IN (
  '19176bc9d632','b45e1e960ad8','92273a10aba0',
  'c8d1c4ef3331','f399fdc5e1ab','d87091e153a9'
)
AND p.type = 'HUMAN'
AND NOT EXISTS (
  SELECT 1 FROM poems ai
  WHERE ai.type = 'AI' AND ai.parent_poem_id = p.id
);

-- 2) No duels reference scoped stale originals
SELECT count(*) AS duel_refs
FROM duels
WHERE poem_a_id IN (
  '19176bc9d632','b45e1e960ad8','92273a10aba0',
  'c8d1c4ef3331','f399fdc5e1ab','d87091e153a9'
)
OR poem_b_id IN (
  '19176bc9d632','b45e1e960ad8','92273a10aba0',
  'c8d1c4ef3331','f399fdc5e1ab','d87091e153a9'
);

-- 3) Global unmatched HUMAN count
SELECT count(*) AS unmatched_human
FROM poems p
WHERE p.type = 'HUMAN'
AND NOT EXISTS (
  SELECT 1 FROM poems ai
  WHERE ai.type = 'AI' AND ai.parent_poem_id = p.id
);

-- 4) Orphan safety checks
SELECT count(*) AS orphan_poem_topics
FROM poem_topics pt
LEFT JOIN poems p ON p.id = pt.poem_id
LEFT JOIN topics t ON t.id = pt.topic_id
WHERE p.id IS NULL OR t.id IS NULL;

SELECT count(*) AS orphan_scrape_sources
FROM scrape_sources s
LEFT JOIN poems p ON p.id = s.poem_id
WHERE p.id IS NULL;

SELECT count(*) AS orphan_duels
FROM duels d
LEFT JOIN poems pa ON pa.id = d.poem_a_id
LEFT JOIN poems pb ON pb.id = d.poem_b_id
WHERE pa.id IS NULL OR pb.id IS NULL;

SELECT count(*) AS orphan_votes
FROM votes v
LEFT JOIN duels d ON d.id = v.duel_id
LEFT JOIN poems p ON p.id = v.selected_poem_id
WHERE d.id IS NULL OR p.id IS NULL;

SELECT count(*) AS orphan_featured_duels
FROM featured_duels fd
LEFT JOIN duels d ON d.id = fd.duel_id
WHERE d.id IS NULL;
```

## Precautions / Safety Requirements

- **No concurrent ETL + AI generation** against same DB.
- **Run dry-run first**, always.
- **Single-operator window**: avoid other write jobs while remediation runs.
- **ID-level guardrails**: execute only against the 6 IDs listed in scope.
- **Cascade awareness**: any delete+reinsert flow may remove related duel/vote chains tied to original IDs; quantify this impact before live run.
- **Reproducibility**: log command lines, run timestamps, and resulting counts in ticket comments.
- **Rollback readiness**: keep pre-flight snapshot artifacts before applying mutations.
- **Seed baseline preservation**: do not modify seed rows (`p1`, `p2`, `p3`, `p4`) as part of this ticket.

## Acceptance Criteria

- [ ] All 6 scoped IDs are handled according to strategy (delete vs split+generate) without orphaning related records.
- [ ] No scoped stale original remains duel-referenced.
- [ ] AI generation succeeds for any newly remediated HUMAN splits (or fails only with new, documented reasons).
- [ ] `Unmatched HUMAN` is reduced from baseline `6`, and scoped IDs are no longer unmatched.
- [ ] No unplanned deletions outside scoped IDs.
- [ ] Final validation report captured and linked in ticket update.

## Notes for Decision

- Manual one-off truncation is not recommended (non-reproducible, fidelity loss).
- Scripted remediation is preferred for auditability and repeatability.
- If script behavior includes non-scoped targets, create a temporary scoped variant or guard flag before live execution.
- Prior docs conflict on `f399fdc5e1ab` classification (non-poem vs valid long poem). This must be resolved before live mutation.
