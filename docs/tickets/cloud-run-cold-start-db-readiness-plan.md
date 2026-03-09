# CRUN-DB-001 — Cloud Run Cold-Start DB Readiness Plan

**Ticket Type:** Reliability / UX / Deployment Hardening
**Status:** Planned
**Priority:** High
**Assignee:** Unassigned
**Labels:** api, web, database, cloud-run, cold-start, reliability, ux
**Related Context:** `cloud-run-deployment-context-issue.md`

## Context

The current API initializes a shared LibSQL/Drizzle client at module load time and passes that singleton into the Hono routers. That keeps the steady-state path simple, but it does not prove that the database is actually reachable before the first user request hits a data route.

In the current Cloud Run deployment, the `sanctuary-web` container is the ingress and proxies `/api/v1` traffic to the `sanctuary-api` sidecar over `localhost:4000`. The homepage immediately requests archive data to populate the featured duel card. After a scale-to-zero cold boot, that first request is therefore exposed to:

- Cloud Run instance startup latency
- sidecar startup ordering between Nginx and Bun
- first-use LibSQL connection establishment
- first-query failure if the database or token is temporarily unavailable

Today, `/health` only returns `{ status: "ok" }` and does not verify database reachability. As a result, the system can appear healthy while the first real archive query still fails.

## Objective

Define and implement a cold-start-safe readiness flow that:

- establishes database connectivity before data routes serve traffic
- exposes a readiness signal that reflects real database reachability
- keeps the homepage in a purposeful loading state inside `id="home-featured-duel-card-body"` while the backend is still warming
- degrades cleanly when the API container is up but the database is not yet ready

## Scope

In scope:

- API-side database warm-up and readiness state
- route-level gating for archive and duel endpoints
- a readiness endpoint separate from liveness
- homepage loading animation and retry behavior around featured duel fetch
- Cloud Run service configuration review for cold-start mitigation

Out of scope:

- changing the database provider
- changing the duel query shape or archive payload contract
- introducing websocket or push-based readiness updates
- broad UI redesign outside the featured duel card body

## Design Decisions

| Decision | Choice |
| :--- | :--- |
| DB client lifetime | Keep one process-level LibSQL/Drizzle client per API instance |
| Readiness model | Add an explicit async warm-up promise with memoized result |
| Health semantics | Split liveness from readiness |
| First-request behavior | Block data routes on readiness instead of letting the first query fail ad hoc |
| Home card UX | Show animated loading state until readiness-backed duel fetch succeeds or fails |
| Failure mode | Return structured `503 Service Unavailable` when warm-up fails or times out |

## Current Constraints

1. `apps/api/src/db/client.ts` creates the database client once at import time and exports it globally.
2. `apps/api/src/index.ts` binds routers immediately and exposes `/health` without any DB verification.
3. `apps/web/pages/Home.tsx` fetches duels on mount and uses `home-featured-duel-card-body` as the visible loading surface.
4. `apps/web/Dockerfile` proxies `/api/v1/` to `http://localhost:4000/api/v1/`, so ingress traffic can arrive at Nginx before the API is functionally ready.
5. `service.yaml` does not currently express any warm-instance mitigation, so cold-start behavior remains user-visible after idle periods.

## Proposed Architecture

```text
Browser loads Home
    |
    v
Home card enters animated "Preparing the ring" state
    |
    v
Web requests API readiness-aware data
    |
    v
API startup creates DB client + kicks off warm-up promise
    |
    +--> warm-up succeeds -> readiness=true -> data routes serve normally
    |
    +--> warm-up pending  -> routes wait up to bounded timeout
    |
    +--> warm-up fails    -> routes return 503 with stable error code
    |
    v
Home card either renders featured duel or a retryable unavailable state
```

## Implementation Plan

### Phase 1: Add API DB readiness lifecycle

#### Task 1.1: Introduce a readiness manager
**Files:** `apps/api/src/db/client.ts`, `apps/api/src/db/config.ts` or new `apps/api/src/db/readiness.ts`

Add a small readiness module that owns:

- a memoized startup promise
- a boolean or timestamp-backed ready state
- the latest warm-up error, if any
- an `ensureDbReady()` function for route handlers and middleware

The warm-up should run a cheap DB operation through the existing client, such as `SELECT 1`, using the already-resolved LibSQL credentials. The logic should not recreate the database client per request.

#### Task 1.2: Make warm-up bounded and explicit
**Files:** `apps/api/src/db/readiness.ts`

Define a bounded wait path so the API does not hang indefinitely during cold boot. The readiness manager should:

- start warm-up during process boot
- retry transient failures a small number of times with short backoff
- surface a stable failure state when warm-up cannot complete

This turns cold-start uncertainty into a controlled outcome instead of letting the first archive request fail deep inside a route query.

#### Task 1.3: Separate liveness from readiness
**Files:** `apps/api/src/index.ts`

Keep `/health` as a lightweight liveness endpoint and add a separate readiness endpoint, for example `/ready` or `/health/ready`, that reports:

- `ready: true` when the DB handshake succeeded
- `ready: false` with `503` while warm-up is pending or has failed
- a stable error code for observability and frontend retry logic

### Phase 2: Gate data routes on readiness

#### Task 2.1: Add readiness middleware or route wrapper
**Files:** `apps/api/src/index.ts`, `apps/api/src/routes/duels.ts`, `apps/api/src/routes/topics.ts`, `apps/api/src/routes/votes.ts`

Ensure that routes touching the database do not execute queries until `ensureDbReady()` resolves. Two acceptable implementations:

1. app-level middleware for `/api/v1/*`
2. per-router wrapper for the DB-backed routers

The goal is consistency. Every DB-backed endpoint should share the same readiness behavior and the same structured `503` response shape.

#### Task 2.2: Preserve anonymous user flow during warm-up
**Files:** `apps/api/src/errors.ts`, `apps/api/src/index.ts`

Add an explicit service-unavailable error type so warm-up failures do not fall through to the generic `500` handler. This keeps the client behavior deterministic and prevents noisy "internal error" semantics for expected cold-start conditions.

### Phase 3: Add homepage loading animation and retry behavior

#### Task 3.1: Upgrade the featured duel loading state
**Files:** `apps/web/pages/Home.tsx`

Replace the current plain `Loading...` copy inside `id="home-featured-duel-card-body"` with a deliberate animated loading state that signals backend warm-up. The animation should stay within the existing visual language and support reduced-motion users.

Recommended behavior:

- initial copy such as `Preparing the ring`
- animated skeleton or shimmer treatment within the card body
- subtle progress affordance rather than an indeterminate spinner only
- fallback message if readiness exceeds a defined wait threshold

#### Task 3.2: Make the homepage fetch readiness-aware
**Files:** `apps/web/lib/api.ts`, `apps/web/pages/Home.tsx`

Keep the user on the loading animation while the first archive request is still blocked by backend readiness. If the API returns a structured `503`, the homepage should:

- retry with short capped backoff
- remain in the animated loading state during retry
- switch to a retryable unavailable state only after the retry budget is exhausted

This avoids flashing a hard error for the normal cold-boot path.

#### Task 3.3: Keep failure UI bounded and actionable
**Files:** `apps/web/pages/Home.tsx`

If readiness does not complete within the retry budget, render an inline fallback in the same card body with:

- a short explanation that the archive is still waking up
- a retry button
- no navigation dead-end for the user

### Phase 4: Deployment hardening review

#### Task 4.1: Review Cloud Run instance-warming strategy
**Files:** `service.yaml`

Evaluate whether the service should keep at least one warm instance for the ingress/API pair. This is an infrastructure tradeoff, not a required code-path fix, so it should be treated as a configurable mitigation rather than the primary solution.

The code changes above must stand on their own even if the service continues to scale to zero.

#### Task 4.2: Confirm sidecar cold-start behavior
**Files:** `apps/web/Dockerfile`, `service.yaml`

Validate that the web ingress gracefully handles the period where Nginx is accepting traffic but the API sidecar is still warming. The readiness-aware client behavior should be enough, but this step ensures the deployment contract matches the new startup flow.

## File Summary

| File | Action | Notes |
| :--- | :--- | :--- |
| `apps/api/src/db/client.ts` | Modify | Keep singleton DB client and trigger warm-up bootstrap |
| `apps/api/src/db/readiness.ts` | Create | Central readiness state and `ensureDbReady()` |
| `apps/api/src/index.ts` | Modify | Add readiness endpoint and readiness gating |
| `apps/api/src/errors.ts` | Modify | Add explicit service-unavailable error type |
| `apps/api/src/routes/duels.ts` | Modify | Ensure warm-up-safe behavior for archive and duel fetches |
| `apps/api/src/routes/topics.ts` | Modify | Ensure warm-up-safe behavior |
| `apps/api/src/routes/votes.ts` | Modify | Ensure warm-up-safe behavior |
| `apps/web/lib/api.ts` | Modify | Handle structured warm-up `503` responses |
| `apps/web/pages/Home.tsx` | Modify | Add animation, retry loop, and unavailable fallback |
| `service.yaml` | Review / Optional Modify | Evaluate warm-instance mitigation |

## Execution Order

1. Add API readiness state and startup warm-up.
2. Introduce readiness endpoint and structured `503` handling.
3. Gate all DB-backed routes on readiness.
4. Upgrade homepage loading state in `home-featured-duel-card-body`.
5. Add retry-aware client logic for cold-start `503` responses.
6. Review `service.yaml` for optional warm-instance mitigation after code-path hardening is complete.

## Edge Cases to Handle

1. **Cold boot with delayed DB reachability**: Routes should wait briefly, then succeed without surfacing a false hard error to the user.
2. **Cold boot with bad credentials**: Readiness should fail deterministically with `503`, not hang indefinitely or emit a misleading `500`.
3. **Ingress reaches Nginx before Bun is ready**: Homepage should stay in loading/retry mode instead of rendering a broken empty state.
4. **User reloads repeatedly during warm-up**: The startup promise must remain memoized per instance and not spawn redundant warm-up loops.
5. **Reduced-motion accessibility**: The featured duel loading animation must degrade to a static or low-motion variant.
6. **DB becomes unavailable after initial readiness**: Follow-up route failures should still surface clean API errors and should not permanently mark the process healthy if reconnection logic is added later.

## Validation Plan

1. Add unit tests for the readiness manager:
   - pending state
   - success path
   - bounded retry failure path
2. Add API route tests proving DB-backed endpoints return structured `503` while readiness is unresolved or failed.
3. Add frontend tests for the homepage card state machine:
   - loading animation on initial mount
   - retry on warm-up `503`
   - fallback message after retry budget exhaustion
   - featured duel render after success
4. Run targeted commands:

```bash
pnpm --filter @sanctuary/api test
pnpm --filter @sanctuary/web test
pnpm lint
```

5. Perform a manual cold-start check against the Cloud Run deployment by allowing the service to idle, then loading the homepage and confirming:
   - the card shows the loading animation first
   - the first successful render transitions directly into a featured duel
   - failures return a bounded unavailable state rather than a blank card

## Rollback Plan

1. Remove the readiness gate and revert routes to direct DB execution.
2. Restore the homepage to the previous simple loading text.
3. Remove any optional service-level warm-instance setting if it was introduced.
4. Keep the explicit readiness endpoint only if it remains useful for operations; otherwise remove it with the gate.

## Acceptance Criteria

- [ ] The API exposes a readiness endpoint that reflects real database reachability.
- [ ] All DB-backed API routes share a consistent readiness gate and structured `503` behavior.
- [ ] The homepage displays an animated loading state inside `id="home-featured-duel-card-body"` while backend readiness is still being established.
- [ ] The homepage retries transient cold-start readiness failures before showing an unavailable state.
- [ ] The first post-idle user experience no longer depends on an unverified first archive query succeeding immediately.
- [ ] Optional Cloud Run warm-instance mitigation is documented as a deployment tradeoff, not relied on as the only fix.

## Notes

- The key change is not "connect earlier" in isolation. The real fix is to make readiness explicit, observable, and shared across the API and homepage UX.
- Keeping the singleton DB client is still the right default. The missing piece is a startup contract that proves the client is usable before data routes depend on it.
