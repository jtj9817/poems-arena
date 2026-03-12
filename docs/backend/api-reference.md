# API Reference

This document outlines the canonical API endpoints and the standardized error handling introduced in Phase 5. The `GET /topics` endpoint and the `topic_id` filter on `GET /duels` were added in Phase 6 (Frontend Integration).

## Base URL

All endpoints are prefixed with `/api/v1/`.

## Error Contract

All error responses follow a standardized JSON envelope:

```json
{
  "error": "Human readable error message",
  "code": "STABLE_ERROR_CODE"
}
```

### Common Error Codes

| Code                 | HTTP | Description                                                               |
| -------------------- | ---- | ------------------------------------------------------------------------- |
| `INVALID_PAGE`       | 400  | The `page` query parameter is missing, non-numeric, or <= 0.              |
| `INVALID_SEED`       | 400  | The `seed` query parameter is present but invalid (not a non-negative safe integer). |
| `MISSING_SEED`       | 400  | The request omitted `seed` without using the `sort=recent` archive bypass. |
| `DUEL_NOT_FOUND`     | 404  | The requested duel ID does not exist OR referenced poem rows are missing. |
| `ENDPOINT_NOT_FOUND` | 404  | The requested endpoint is unknown or has been deprecated/removed.         |

---

## Endpoints

### 1. `GET /topics`

Returns all canonical topics, ordered alphabetically by label. Used to populate the Past Bouts topic filter bar.

- **Query Parameters:** none
- **Response `200 OK`:**
  - `Array<TopicMeta>`

#### `TopicMeta` Object
```typescript
{
  id: string | null;   // Canonical topic ID (e.g. 'nature', 'love')
  label: string;       // Display name (e.g. "Nature", "Love")
}
```

---

### 2. `GET /duels`

Returns a paginated list of duel cards. This endpoint serves two ordering modes:

- seeded rotation for Home and The Ring
- chronological archive ordering for Past Bouts via `sort=recent`

- **Query Parameters:**
  - `page` (optional): Positive integer. Defaults to `1`.
  - `topic_id` (optional): Canonical topic ID string. When present, filters results to duels whose `topic_id` matches. Returns an empty array for unknown IDs.
  - `seed` (required unless `sort=recent`): Non-negative safe integer used to derive a deterministic pivot over `duels.id`.
  - `sort` (optional): `recent` is the only supported value. It bypasses the seed requirement and preserves `created_at DESC` ordering for archive views.
- **Response `200 OK`:**
  - `Array<DuelCard>`
- **Response `400 Bad Request`:**
  - `{ "error": "Invalid page number", "code": "INVALID_PAGE" }`
  - `{ "error": "Invalid seed value", "code": "INVALID_SEED" }`
  - `{ "error": "Missing required seed", "code": "MISSING_SEED" }`

**Ordering rules:**

- If `seed` is supplied, results are rotated deterministically using a seed-derived duel pivot and `duels.id ASC`.
- If `sort=recent` is supplied, results use chronological `created_at DESC`.
- If neither `seed` nor `sort=recent` is supplied, the request fails with `400 MISSING_SEED`.

**Pagination:** 12 duels per page. When `topic_id` is supplied and no matches exist, returns `[]` with `200 OK`.

#### `DuelCard` Object
```typescript
{
  id: string;
  topic: string;              // Raw duel topic string (legacy)
  topicMeta: {
    id: string | null;        // null when the duel has no linked topic row
    label: string;            // Falls back to raw topic string when id is null
  };
  humanWinRate: number;       // Integer percentage 0–100 (0 when no votes cast)
  avgReadingTime: string;     // Hardcoded "3m 30s" in list view
  createdAt: string;          // ISO 8601
}
```

**Usage by client:**

- `Home.tsx` calls `GET /duels?page=1&seed=<session-seed>` and uses the first row as the featured duel.
- `TheRing.tsx` calls `GET /duels?page=N&seed=<session-seed>` for queue bootstrap and later page fetches.
- `PastBouts.tsx` calls `GET /duels?page=1&sort=recent[&topic_id=...]` to preserve archive chronology.

### 3. `GET /duels/:id`

**Canonical endpoint for duel retrieval.** Used when entering The Ring.
Calling this endpoint logs a "featured" event in the `featured_duels` table for analytics.

- **URL Parameters:**
  - `id`: The unique ID of the duel.
- **Response `200 OK`:**
  - Anonymous duel payload (poem authors and types are hidden).
- **Response `404 Not Found`:**
  - `{ "error": "Duel not found", "code": "DUEL_NOT_FOUND" }`

### 4. `GET /duels/:id/stats`

Returns reveal metadata, statistics, and source provenance for a completed duel. Consumed by `VerdictPopup` after the user votes.

- **URL Parameters:**
  - `id`: The unique ID of the duel.
- **Response `200 OK`:**
  - `{ humanWinRate, avgReadingTime, duel }` where `duel` includes full poem reveal and `sourceInfo`.
  - `humanWinRate`: integer percentage 0–100.
  - `avgReadingTime`: dynamically computed from combined word count at ~200 wpm (e.g. `"3m 30s"`).
  - `duel.topicMeta`: same shape as in `DuelCard` — includes `id` and `label`.
  - `duel.poemA / poemB`: full `Poem` including `author`, `type`, `year`, and `sourceInfo`.
  - `sourceInfo.primary`: `{ source: string | null, sourceUrl: string | null }` — from `poems.source` / `poems.source_url`.
  - `sourceInfo.provenances`: array of `scrape_sources` rows sorted by `scrapedAt` descending.
- **Response `404 Not Found`:**
  - `{ "error": "Duel not found", "code": "DUEL_NOT_FOUND" }`

---

## Deprecated / Removed Endpoints

### `GET /duels/today` [REMOVED]

This endpoint has been removed in Phase 5 to support a many-duels-per-day model. Clients should now use `GET /duels` to discover available duels and `GET /duels/:id` to retrieve them.

Requests to this endpoint will return:
- **HTTP 404**
- **Payload:** `{ "error": "Endpoint not found", "code": "ENDPOINT_NOT_FOUND" }`
