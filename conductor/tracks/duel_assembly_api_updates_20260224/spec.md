# Specification: Phase 5 - Duel Assembly & API Updates

## Overview

This track implements Phase 5 of the Data Pipeline plan. It focuses on taking the generated AI poems and their human counterparts, assembling them into duels, and exposing these duels via the API. It also handles the logic for selecting the daily featured duel.

## Functional Requirements

1.  **Auto-Pairing Logic:**
    - Implemented as a step within the `packages/ai-gen` process.
    - For every human poem that has a generated AI counterpart (linked via `parent_poem_id`), a duel must be created.
    - The `topic` for the duel should be inherited from the shared topic.
    - The assignment of Human vs. AI to `poem_a` or `poem_b` must be randomized to prevent positional bias.

2.  **Daily Duel Tracking:**
    - A new table, `featured_duels`, must be created to track which duels have been featured and on what date.

3.  **API Updates (`apps/api`):**
    - `GET /duels/today`: Selects a duel that hasn't been featured recently. The rotation should prioritize topics that have the largest pool of unused duels. Once selected, it should be recorded in the `featured_duels` table.
    - `GET /duels`: Updated to return topic metadata alongside the duel data.
    - `GET /duels/:id/stats`: Updated to include the topic and the source information for the poems involved.

## Out of Scope

- Frontend integration (Anthology filtering, source attribution on Verdict, topic tags on duel cards). These are part of Phase 6.
