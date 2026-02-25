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
      - Error handling rules:
        - If duel ID does not exist, return `404`.
        - If duel exists but either referenced poem row is missing, return `404` with error message `'Duel not found'`.
    - `GET /duels`: Updated to return topic metadata alongside duel data and support client selection of multiple duels per day.
      - Required response contract per item:
        - `id`, `createdAt`, `humanWinRate`, `avgReadingTime`
        - `topic` (legacy display string for cards)
        - `topicMeta`: `{ id: string | null, label: string }`
      - Query validation rules:
        - `page` must be a positive integer.
        - Invalid `page` values (`0`, negative, non-integer, non-numeric) must return `400`.
        - `400` responses must use a stable error body shape:
          - `{ "error": string, "code": "INVALID_PAGE" }`
      - Topic resolution rules:
        - Use `duels.topic_id -> topics.id` when present.
        - If `topic_id` is null or join misses, set `topicMeta.id = null` and `topicMeta.label = duels.topic`.
    - `GET /duels/:id/stats`: Updated to include topic metadata and source information for both poems.
      - Required response contract:
        - `humanWinRate`, `avgReadingTime`
        - `duel`: `{ id, topic, topicMeta, poemA, poemB }`
      - `poemA` and `poemB` must include:
        - poem fields used by current reveal flow (`id`, `title`, `content`, `author`, `type`)
        - `sourceInfo`:
          - `primary`: `{ source: string | null, sourceUrl: string | null }`
          - `provenances`: `Array<{ source: string, sourceUrl: string, scrapedAt: string, isPublicDomain: boolean }>`
      - Source resolution rules:
        - `primary` comes from `poems.source` and `poems.source_url`.
        - `provenances` comes from `scrape_sources` for the poem ID (sorted by `scraped_at` descending).
        - AI poems may have empty `provenances` arrays; this is valid.
      - Error handling rules:
        - If duel ID does not exist, return `404`.
        - If duel exists but either referenced poem row is missing, return `404` with error message `'Duel not found'`.
    - `GET /duels/today`: Fully deprecated and removed from the active API contract for this track. Active clients must use `GET /duels` to choose duel IDs and `GET /duels/:id` to retrieve a duel payload.

4.  **Testing & Coverage Requirements:**
    - Add route-level unit tests in `@sanctuary/api` for:
      - `GET /duels`, `GET /duels/:id`, `GET /duels/:id/stats`
      - `GET /duels/today` removal behavior
      - query validation (`page`) and missing-poem `404` behavior
    - Add unit tests in `@sanctuary/ai-gen` for duel assembly policy:
      - many-duels-per-poem
      - unordered pair uniqueness
      - rerun idempotency
      - bounded fan-out and deterministic candidate selection
      - randomized first-time orientation
    - Coverage targets:
      - `apps/api/src/routes/duels.ts`: at least 85% statement and branch coverage
      - duel-assembly module in `@sanctuary/ai-gen`: at least 90% statement and branch coverage
      - package-level floor: at least 80% for `@sanctuary/api` and `@sanctuary/ai-gen`
    - Coverage enforcement:
      - Coverage thresholds are a hard CI gate for this track.
      - PRs must fail when thresholds are not met.

## Out of Scope

- Frontend integration (Anthology filtering, source attribution on Verdict, topic tags on duel cards). These are part of Phase 6.
