# Backend Documentation

This directory contains documentation related to the API, database schema, and backend logic.

## API Documentation

- [**API Reference**](./api-reference.md): Canonical endpoints for duels and error contracts.
- [**AI Generation Prompts (DeepSeek)**](./ai-gen-prompts.md): Prompts used for poem generation and verification.

## Database Schema

- [**Featured Duels Schema**](./featured-duels-schema.md): Schema contract for global duel exposure tracking.

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
