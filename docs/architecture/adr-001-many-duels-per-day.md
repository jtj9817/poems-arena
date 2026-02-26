# ADR 001: Transition to Many-Duels-Per-Day Model

**Date:** 2026-02-26
**Status:** Accepted
**Context:** Phase 5 (Duel Assembly & API Updates)

## Context

The initial product spec envisioned a strict "Daily Duel" model: one specific duel would be featured per day, accessed via a `GET /duels/today` endpoint. As the data pipeline evolved to generate thousands of poems and assemble many duels, it became clear that locking the platform to a single daily duel created several limitations:
1. **Low Data Velocity:** Gathering statistically significant win-rate data on human vs. AI pairs would take years if only one pair was tested per day.
2. **Brittle State:** Relying on a single row to represent "today" makes caching and timezone handling unnecessarily complex.
3. **Restricted UX:** Users visiting the site multiple times a day or wanting to evaluate multiple pairs would hit a wall immediately.

## Decision

We are moving away from a strict single-daily-duel constraint to a "featured duels" model that supports many duels per day.

1. **Remove `/today` Endpoint:** The `GET /duels/today` API endpoint has been deprecated and removed.
2. **Canonical ID Retrieval:** The primary mechanism for entering the Reading Room is now `GET /duels/:id`. Clients (like The Anthology or The Foyer) are responsible for selecting the ID they wish to present.
3. **Append-Only Tracking:** We introduced a `featured_duels` table. Whenever `GET /duels/:id` is accessed, an exposure record is logged with the current UTC date.

## Consequences

### Positive
- **Higher Throughput:** Users can evaluate multiple duels per session, drastically increasing the velocity of our "Turing test" data collection.
- **Simplified API:** Removing the temporal lock (`/today`) simplifies API caching and removes edge cases around timezone rollovers.
- **Analytics:** The `featured_duels` table provides an append-only, global log of which duels are actively being surfaced and engaged with over time.

### Negative
- **Client Logic:** The frontend now bears slightly more responsibility for deciding *which* duel to feature on the Foyer (e.g., picking a random duel from a list of available duels rather than just asking the backend for "today's").
