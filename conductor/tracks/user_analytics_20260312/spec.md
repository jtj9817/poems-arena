# Specification: User Analytics & Global Statistics (The Verdict)

## Overview
This track implements the logic and UI for real-time global statistics to be displayed on the "Verdict" screen. It replaces currently hardcoded values with actual aggregated data, tracking human vs. AI win rates globally and by topic, as well as the average reading time per duel.

## Functional Requirements
1. **Aggregated Data Storage:**
   - Introduce dedicated tables or aggregate rows in the database (LibSQL/Drizzle) to store running totals and averages for win rates (global and per topic) and reading times.
2. **Reading Time Measurement:**
   - Implement client-side tracking to measure the time between page load (Reading Room) and vote submission.
   - Implement server-side fallback timestamps as a secondary measure if client-side data is unavailable.
   - Add backend logic to reject outliers (e.g., sessions > 10 minutes) before updating averages, preventing skewed data.
3. **Verdict Screen UI:**
   - Update the Verdict screen in the frontend (React/Vite).
   - Display visual progress bars comparing Human vs. AI win rates globally.
   - Show a breakdown of the win rate for the specific topic of the duel, comparing it to the global average.

## Non-Functional Requirements
- **Performance:** Aggregated tables must allow fast read operations for the Verdict screen, ensuring no noticeable delay after voting. Updates to aggregates should happen asynchronously or alongside the vote insertion in an efficient transaction.
- **Accuracy:** The outlier rejection must accurately filter extreme values without dropping legitimate long reads.

## Acceptance Criteria
- [ ] Voting updates the aggregated statistics correctly in the database.
- [ ] Reading time is captured accurately from the client, falls back to server time if needed, and ignores outliers.
- [ ] The Verdict screen displays dynamic win rate bars comparing human and AI success.
- [ ] The Verdict screen displays a topic-specific win rate breakdown.
- [ ] The hardcoded data on the Verdict screen is completely removed.

## Out of Scope
- Detailed per-user historical tracking (focus is on global aggregates).
- Time-series graphing of stats over time (e.g., win rates by day/month).
