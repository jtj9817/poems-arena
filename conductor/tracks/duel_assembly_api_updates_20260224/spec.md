# Specification: Phase 5 - Duel Assembly & API Updates

## Overview

This track implements Phase 5 of the Data Pipeline plan. It focuses on taking generated AI poems and their human counterparts, assembling them into duels, and exposing these duels via API-first retrieval by duel ID. This track also introduces global duel exposure logging for analytics and rotation support.

## Functional Requirements

1.  **Auto-Pairing Logic:**
    - Implemented as a step within the `packages/ai-gen` process.
    - For every human poem that has a generated AI counterpart (linked via `parent_poem_id`), a duel must be created.
    - The `topic` for the duel should be inherited from the shared topic.
    - The assignment of Human vs. AI to `poem_a` or `poem_b` must be randomized to prevent positional bias.

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
