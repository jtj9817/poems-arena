# Backend Documentation

This directory contains documentation related to the API, database schema, and backend logic.

## API Documentation

- [**API Reference**](./api-reference.md): Canonical endpoints for duels, votes, and error contracts.
- [**AI Generation Prompts (DeepSeek)**](./ai-gen-prompts.md): Prompts used for poem generation and verification.

## Database Schema

- [**Featured Duels Schema**](./featured-duels-schema.md): Schema contract for global duel exposure tracking.

---

## Analytics Aggregates

The User Analytics & Global Statistics track (shipped 2026-03-13) introduced two pre-computed aggregate tables. These replace the old word-count `avgReadingTime` estimate with behavioral data derived from real user votes.

### `global_statistics`

Single-row table keyed by `id = 'global'`. Stores all-time vote totals and decision-time sums across every duel in the system.

| Column               | Type      | Description                                                    |
| -------------------- | --------- | -------------------------------------------------------------- |
| `id`                 | `text`    | Always `'global'` — single-row sentinel key                    |
| `totalVotes`         | `integer` | Total votes cast across all duels                              |
| `humanVotes`         | `integer` | Votes where the human poem was selected                        |
| `decisionTimeSumMs`  | `integer` | Cumulative sum of all clamped `readingTimeMs` values (ms)      |
| `decisionTimeCount`  | `integer` | Number of votes that contributed a timing sample               |
| `updatedAt`          | `text`    | ISO 8601 timestamp of last update                              |

**Derived fields (computed at query time):**
- `humanWinRate = round(humanVotes / totalVotes * 100)` (0 when `totalVotes = 0`)
- `avgDecisionTimeMs = round(decisionTimeSumMs / decisionTimeCount)` (null when `decisionTimeCount = 0`)
- `avgDecisionTime` = formatted as `"Xm YYs"` (e.g. `"2m 00s"`)

### `topic_statistics`

One row per canonical topic (`topicId` is the primary key, foreign-keyed to `topics.id`). Stores per-topic vote totals and decision-time sums. The `topicLabel` column is denormalized for display stability.

| Column               | Type      | Description                                                     |
| -------------------- | --------- | --------------------------------------------------------------- |
| `topicId`            | `text`    | Primary key; references `topics.id`                             |
| `topicLabel`         | `text`    | Denormalized topic display name (snapshot at last write time)   |
| `totalVotes`         | `integer` | Total votes cast for duels with this topic                      |
| `humanVotes`         | `integer` | Votes where the human poem was selected for this topic          |
| `decisionTimeSumMs`  | `integer` | Cumulative sum of clamped `readingTimeMs` for this topic (ms)   |
| `decisionTimeCount`  | `integer` | Number of timed votes for this topic                            |
| `updatedAt`          | `text`    | ISO 8601 timestamp of last update                               |

### Update Strategy

Aggregates are updated **atomically** on every valid vote write using `db.batch([...])`, which sends three statements in a single `BEGIN/COMMIT` on the same connection:

1. `INSERT INTO votes` — the vote row (with clamped `readingTimeMs`).
2. `INSERT OR REPLACE INTO global_statistics` (upsert) — increments all global counters.
3. `INSERT OR REPLACE INTO topic_statistics` (upsert) — increments topic-scoped counters.

This keeps Verdict reads constant-time (no table scans) and ensures aggregate counts are always consistent with the `votes` table.

### Topic-Keying Rules

- `topic_statistics` is keyed by `duels.topicId` only.
- `duels.topicId` is **non-nullable** (enforced at the schema level); every duel must belong to a canonical `topics` row.
- A vote for a duel with an unknown or null `topicId` will be rejected at the database layer before aggregates are touched.

### `readingTimeMs` Validation and Clamping

The `readingTimeMs` field is required in every `POST /votes` request:

| Value                   | Behavior                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| `> 0` and `<= 600000`  | Accepted and stored as-is; used verbatim in aggregate `decisionTimeSumMs`.   |
| `> 600000`              | Clamped to `600000` (10 minutes) before insert — prevents outlier skew from stale/backgrounded tabs. |
| `<= 0` or non-integer  | Rejected with HTTP `400`; vote row is not inserted, aggregates are not mutated. |

### Initialization

Aggregate rows are initialized at zero and build from new votes only. Old votes cast before this track shipped do not have `readingTimeMs` values, so aggregate counts start from zero rather than being backfilled.

---

## DB Readiness and Cold-Start Infrastructure

The API implements a bounded retry warm-up system to handle Cloud Run cold-start latency (scale-to-zero). This is distinct from the health check — the health check is a trivial liveness probe, while readiness verifies actual database connectivity.

### Key Files

| File | Purpose |
| --- | --- |
| `apps/api/src/db/readiness-manager.ts` | `createDbReadinessManager()` — pure state machine. Accepts a `ping` function and manages retry loops with configurable `maxAttempts`, `retryDelayMs`, and `waitTimeoutMs`. Exposes `start()`, `ensureReady()`, `getSnapshot()`. |
| `apps/api/src/db/readiness.ts` | Singleton instance of the manager wired to the live LibSQL client. Exports `startDbWarmup()`, `ensureDbReady()`, `getDbReadinessSnapshot()`. Reads `DB_READY_*` env vars for override. |
| `apps/api/src/readiness-log.ts` | `formatDbReadinessFailureLog()` — structured log helper that deliberately redacts error message details (logs "details redacted" rather than raw DB error strings) to avoid leaking connection metadata. |
| `apps/api/src/errors.ts` | `ServiceUnavailableError` — `ApiError` subclass with HTTP 503 and code `SERVICE_UNAVAILABLE`. |

### Startup Flow

1. At API boot (`index.ts`), `startDbWarmup()` is called fire-and-forget. It issues `SELECT 1` against the LibSQL client up to `DB_READY_MAX_ATTEMPTS` times with `DB_READY_RETRY_DELAY_MS` between attempts.
2. All `/api/v1/*` requests (except `OPTIONS`) pass through a middleware that calls `ensureDbReady()`. If the DB is not yet ready, the middleware throws `ServiceUnavailableError` → HTTP 503.
3. `GET /ready` calls `ensureDbReady()` directly and returns the snapshot. This is the Cloud Run readiness probe target.
4. `GET /health` returns `{ status: "ok", version }` without touching the DB — pure liveness.

### Configuration

| Env Variable | Default | Description |
| --- | --- | --- |
| `DB_READY_MAX_ATTEMPTS` | `4` | Max ping attempts before the manager marks status as `failed` |
| `DB_READY_RETRY_DELAY_MS` | `300` | Delay between successive ping attempts |
| `DB_READY_WAIT_TIMEOUT_MS` | `2500` | Overall timeout budget for `ensureDbReady()` to wait |

### Readiness Status States

The manager tracks a `DbReadinessStatus` of `'pending' | 'ready' | 'failed'`. Once `'ready'` is reached, `ensureReady()` resolves immediately on all subsequent calls (the warmup `Promise` is cached).

### Client-Side Handling (Home.tsx)

The `Home.tsx` component handles `503 SERVICE_UNAVAILABLE` with a bounded retry loop (up to 4 attempts, delays `[500, 900, 1400, 2000]ms`). During retries it cycles through status messages and shows a progress-dot indicator. After exhausting retries it surfaces an error with a "Retry" button.
