# `featured_duels` Table — Schema Contract

## Purpose

Tracks duel exposure events by UTC date for global analytics and rotation support.
This table is **append-only** — rows are never updated or deleted.

## Columns

| Column        | Type            | Constraints                    | Description                                        |
| ------------- | --------------- | ------------------------------ | -------------------------------------------------- |
| `id`          | `INTEGER`       | `PRIMARY KEY AUTOINCREMENT`    | Auto-incrementing surrogate key                    |
| `duel_id`     | `TEXT NOT NULL` | `REFERENCES duels(id)`         | Foreign key to the exposed duel                    |
| `featured_on` | `TEXT NOT NULL` | —                              | UTC date of exposure in `YYYY-MM-DD` format        |
| `created_at`  | `TEXT NOT NULL` | `DEFAULT strftime(..., 'now')` | UTC timestamp when the exposure record was created |

## Indexes

| Index Name                       | Column        | Unique |
| -------------------------------- | ------------- | ------ |
| `featured_duels_featured_on_idx` | `featured_on` | No     |
| `featured_duels_duel_id_idx`     | `duel_id`     | No     |

Indexes are **non-unique** to support multiple rows per day and per duel.

## Cardinality Rules

- **Multiple records per UTC day are allowed** — the same or different duels can generate multiple exposure rows on the same day.
- **The same duel can be logged multiple times on the same UTC day** — there is no uniqueness constraint on `(duel_id, featured_on)`.
- **Table is global, not user-scoped** — exposure tracking is not tied to any individual user session.

## Lifecycle

An exposure row is inserted whenever `GET /duels/:id` is called successfully. The table is never updated.

## Example Row

```json
{
  "id": 42,
  "duel_id": "duel-abc123",
  "featured_on": "2026-02-25",
  "created_at": "2026-02-25T14:30:00.000Z"
}
```
