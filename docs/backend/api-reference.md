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
| `DUEL_NOT_FOUND`     | 404  | The requested duel ID does not exist OR referenced poem rows are missing. |
| `ENDPOINT_NOT_FOUND` | 404  | The requested endpoint is unknown or has been deprecated/removed.         |

---

## Endpoints

### 1. `GET /topics`

Returns all canonical topics, ordered alphabetically by label. Used to populate the Anthology topic filter bar.

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

Returns a paginated list of duel cards for the Anthology/Archive view.

- **Query Parameters:**
  - `page` (optional): Positive integer. Defaults to `1`.
  - `topic_id` (optional): Canonical topic ID string. When present, filters results to duels whose `topic_id` matches. Returns an empty array for unknown IDs.
- **Response `200 OK`:**
  - `Array<DuelCard>`
- **Response `400 Bad Request`:**
  - `{ "error": "Invalid page number", "code": "INVALID_PAGE" }`

#### `DuelCard` Object
```typescript
{
  id: string;
  topic: string;              // Legacy display string
  topicMeta: {
    id: string | null;
    label: string;
  };
  humanWinRate: number;       // 0-1
  avgReadingTime: number;     // seconds
  createdAt: string;          // ISO 8601
}
```

### 3. `GET /duels/:id`

**Canonical endpoint for duel retrieval.** Used when entering the Reading Room.
Calling this endpoint logs a "featured" event in the `featured_duels` table for analytics.

- **URL Parameters:**
  - `id`: The unique ID of the duel.
- **Response `200 OK`:**
  - Anonymous duel payload (poem authors and types are hidden).
- **Response `404 Not Found`:**
  - `{ "error": "Duel not found", "code": "DUEL_NOT_FOUND" }`

### 4. `GET /duels/:id/stats`

Returns reveal metadata, statistics, and source provenance for a completed duel.

- **URL Parameters:**
  - `id`: The unique ID of the duel.
- **Response `200 OK`:**
  - Stats payload including `sourceInfo` with `primary` and `provenances` (sorted by `scrapedAt` descending).
- **Response `404 Not Found`:**
  - `{ "error": "Duel not found", "code": "DUEL_NOT_FOUND" }`

---

## Deprecated / Removed Endpoints

### `GET /duels/today` [REMOVED]

This endpoint has been removed in Phase 5 to support a many-duels-per-day model. Clients should now use `GET /duels` to discover available duels and `GET /duels/:id` to retrieve them.

Requests to this endpoint will return:
- **HTTP 404**
- **Payload:** `{ "error": "Endpoint not found", "code": "ENDPOINT_NOT_FOUND" }`
