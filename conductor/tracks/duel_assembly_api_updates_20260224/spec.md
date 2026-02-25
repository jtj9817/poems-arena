# Specification: Phase 5 - Duel Assembly & API Updates

## Overview

This track implements Phase 5 of the Data Pipeline plan. It focuses on taking generated AI poems and their human counterparts, assembling them into duels, and exposing these duels via API-first retrieval by duel ID. This track also introduces global duel exposure logging for analytics and rotation support.

## Functional Requirements

1.  **Auto-Pairing Logic:**
    - Implemented as a step within the `packages/ai-gen` process.
    - Pairing model is **many-duels-per-poem**:
      - A HUMAN poem can be matched with multiple AI poems in the same topic pool.
      - This supports Turing-test-style repeated evaluation and stronger stats across duels.
    - Pair uniqueness rule:
      - Each unordered poem pair can exist at most once as a duel.
      - `(poem_x, poem_y)` and `(poem_y, poem_x)` are the same logical pair and must not create duplicates.
    - Topic rule:
      - Duel candidates should be formed from HUMAN and AI poems that share the selected duel topic.
      - `duels.topic_id` and display `duels.topic` must resolve from that selected topic.
    - Direct counterpart rule:
      - If a HUMAN poem has an AI counterpart linked by `parent_poem_id`, that pair is eligible but not exclusive.
    - Positional bias rule:
      - On first creation of a unique pair, assignment to `poem_a` vs `poem_b` must be randomized and then persisted.
    - Scale guard:
      - Pair generation must use bounded fan-out per HUMAN poem (deterministic selection order) to avoid combinatorial explosion on large datasets.

2.  **Global Duel Exposure Tracking (`featured_duels`):**
    - A new table, `featured_duels`, must be created to track duel exposure events by UTC date.
    - Required columns:
      - `id` (autoincrement primary key)
      - `duel_id` (`TEXT NOT NULL`, foreign key to `duels.id`)
      - `featured_on` (`TEXT NOT NULL`, UTC date in `YYYY-MM-DD`)
      - `created_at` (`TEXT NOT NULL`, default UTC timestamp)
    - Required indexes:
      - index on `featured_on`
      - index on `duel_id`
    - Cardinality and replay rules:
      - multiple rows per UTC day are allowed
      - the same duel can be logged multiple times on the same UTC day
      - table is append-only historical tracking for global usage (not user-scoped)

3.  **API Updates (`apps/api`):**
    - `GET /duels/:id`: Becomes the canonical duel retrieval endpoint for active play. It must return an anonymous duel payload and log exposure in `featured_duels`.
    - `GET /duels`: Updated to return topic metadata alongside duel data and support client selection of multiple duels per day.
    - `GET /duels/:id/stats`: Updated to include topic metadata and source information for both poems.
    - `GET /duels/today`: Deprecated or removed from active contract. If kept temporarily for compatibility, it should internally resolve through the same duel selection/retrieval flow as `GET /duels/:id`.

## Out of Scope

- Frontend integration (Anthology filtering, source attribution on Verdict, topic tags on duel cards). These are part of Phase 6.
