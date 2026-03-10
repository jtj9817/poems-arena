# Security Review: Branch main — 2026-03-09

**Ticket Type**: Security Review
**Status**: Closed — Hardening Applied
**Priority**: Informational
**Labels**: security, review, api, deployment
**Scope**: 30 commits ahead of `origin/main`

---

## Summary

A security review was conducted against all changes on the current branch relative to `origin/main`. No high-confidence (≥ 8/10) exploitable vulnerabilities were identified. One candidate was flagged and then ruled out after deeper analysis.

---

## Scope

Files reviewed included:

| Area | Files |
|---|---|
| API routing & middleware | `apps/api/src/index.ts`, `apps/api/src/errors.ts` |
| DB readiness gating | `apps/api/src/db/readiness-manager.ts`, `apps/api/src/db/readiness.ts` |
| API route handlers | `apps/api/src/routes/duels.ts` |
| Frontend API client | `apps/web/lib/api.ts` |
| Deployment scripts | `scripts/deploy.sh`, `scripts/bump-version.ts` |
| Infrastructure config | `service.yaml`, `cloudbuild.yaml`, `docker-compose.yml` |
| Container builds | `apps/api/Dockerfile`, `apps/web/Dockerfile` |

---

## Findings

### No actionable vulnerabilities

All areas reviewed were assessed as secure under the applied threat model.

| Area | Verdict | Notes |
|---|---|---|
| SQL injection surface | ✅ Safe | Drizzle ORM uses parameterized queries throughout |
| Input validation | ✅ Safe | Vote and duel inputs validated via Zod before DB writes |
| Version bump script | ✅ Safe | Strict regex `/^\d+\.\d+$/` guards file writes |
| CORS configuration | ✅ Safe | Origins hardcoded or from trusted env vars — no injection vector |
| Docker build args | ✅ Safe | No secrets baked into image layers |
| Auth bypass paths | ✅ N/A | No authentication system in scope |

---

## Candidate Finding (Filtered — Confidence 5/10)

### Error message detail in `/ready` endpoint

- **File:** `apps/api/src/index.ts`
- **Category:** Information Disclosure
- **Description:** The `/ready` endpoint returns `snapshot.lastError` (raw LibSQL connection error message) in 503 responses. The `/api/v1/*` readiness middleware appends the same error string to thrown `ServiceUnavailableError` messages.
- **Why filtered:** Error messages originate from LibSQL connection failures against a Turso-hosted database. They do not contain auth tokens, raw env var values, or credentials — only generic network/connection strings. Turso database hostnames are anonymized subdomains. This is a hardening consideration rather than a concrete exploitable vulnerability.
- **Hardening note (non-blocking):** Log `lastError` server-side and return a generic `"Database is not ready"` message to clients. No remediation required before deployment.
- **Resolution:** Applied. `apps/api/src/index.ts` updated: both the `/ready` 503 response and the `/api/v1/*` readiness middleware now log the raw `snapshot.lastError` to `console.error` server-side and return the fixed string `"Database is not ready"` to clients. The e2e health assertion was also corrected (`toEqual` → `toMatchObject`) to account for the `version` field added in commit `0c42bfa`.

---

## Confirmed Secure Patterns

- Drizzle ORM parameterized queries — no SQL injection surface
- Zod schema validation on all POST bodies at route entry
- `scripts/bump-version.ts` version format validated before any filesystem writes
- CORS origins fully hardcoded in `apps/api/src/index.ts` with an optional env var — no user-controlled origin reflection
- Docker multi-stage builds use frozen lockfile (`pnpm install --frozen-lockfile`) and no credentials in ARGs

---

## Conclusion

No vulnerabilities requiring remediation were identified. The codebase follows secure patterns for ORM usage, input validation, and infrastructure configuration consistent with a low-attack-surface read-heavy public API.
