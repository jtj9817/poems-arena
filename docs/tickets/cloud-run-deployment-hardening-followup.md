# CRUN-DEPLOY-002 — Cloud Run Deployment Hardening Follow-up

**Ticket Type:** Reliability / Deployment Hardening
**Status:** In Progress
**Priority:** High
**Assignee:** Unassigned
**Labels:** `cloud-run`, `deployment`, `docker`, `reliability`, `ops`
**Related Context:** `cloud-run-deployment-context-issue.md`, `cloud-run-cold-start-db-readiness-plan.md`
**Last Updated:** 2026-03-10

## Summary

The local build-and-push deployment path now works, but the current logs still expose avoidable failure modes:

- mutable image references (`:latest`)
- weak post-deploy verification
- nondeterministic package-manager behavior in container builds
- missing Docker context filtering
- ingress-side proxy failures that can surface before the API sidecar is ready
- noisy or inconsistent operational signals during deployment

This ticket tracks the next hardening pass so deployment failures become more diagnosable and less dependent on best-case network and startup timing.

## Implementation Progress

### Completed

- Added deploy-time public smoke checks for `/health` and `/ready` before reporting success.
- Added ingress proxy coverage for `/health` and `/ready`.
- Normalized ingress-side sidecar startup failures into a stable retryable JSON `503`.
- Pinned pnpm usage in repository and container paths.
- Added root `.dockerignore` for Docker context hygiene.
- Switched deployment flow to immutable image references:
  - build/push unique run tags (defaulting to git SHA fallback)
  - resolve pushed digests
  - render `service.deployed.yaml` with digest refs
- Removed `gcloud config set project` mutation from deploy flow and now pass `--project` explicitly.

### Remaining

- Web image install remains large (`+270` packages) because the web build toolchain itself is heavy and includes test tooling (`vitest`) in package-level dev dependencies.
- Transient npm registry `ETIMEDOUT` retries are still observed during web image install, though retry budget is now increased.

## Problem Statement

The deployment succeeded, but the success path still relied on favorable conditions:

1. The web image build downloaded a broad dependency set and encountered transient npm registry timeouts.
2. The deploy script declared success without verifying service liveness or readiness through the public ingress.
3. The web ingress only proxied `/api/v1/`, which limited smoke-test coverage and left sidecar startup behavior partially implicit.
4. Docker build inputs were not explicitly constrained by a root `.dockerignore`.
5. The repository did not pin a workspace pnpm version, while the web container installed whatever pnpm release was current at build time.

## Findings

### High

1. **Web build still installs an oversized dependency graph**
   - `apps/web/Dockerfile` performs a full workspace install.
   - Logs showed 270 packages and repeated `ETIMEDOUT` retries from `registry.npmjs.org`.
   - This increases build time and raises the odds of flaky deploys under transient network issues.

2. **Deploy success is not equivalent to service readiness**
   - `gcloud run services replace` only confirms the revision was accepted.
   - The current script does not verify `/health` or `/ready` from the public service URL before reporting success.

3. **Mutable image tags complicate rollback and concurrent deploy safety**
   - The service manifest still points at `:latest`.
   - This makes revision provenance weaker and increases ambiguity during rollback, race conditions, and incident review.

### Medium

4. **Container package-manager behavior is not fully pinned**
   - The repository had no root `packageManager` declaration.
   - The web image installed the latest global pnpm at build time, which already diverged from the local machine version in observed logs.

5. **Ingress-side cold-start failures can still leak through the proxy boundary**
   - Nginx may accept traffic before the Bun API sidecar is reachable.
   - Without proxy normalization, clients can see raw `502/504` responses instead of stable readiness-style `503` payloads.

6. **Docker build context filtering is implicit rather than explicit**
   - There was no root `.dockerignore`.
   - Local builds happened to keep contexts small, but the repository still contains logs, local DB files, `node_modules`, and other non-build artifacts.

### Low

7. **Operational output is still noisier than necessary**
   - `gcloud config set project` emits the project environment-tag warning on every run.
   - The deploy logs may show multiple service URLs from different commands, which is confusing during verification.

## Scope

In scope:

- deployment-script preflight and verification hardening
- Docker build input hygiene
- container package-manager determinism
- ingress proxy behavior for sidecar startup edge cases
- smoke-test coverage for deployed service health/readiness

Out of scope:

- replacing Cloud Run with another deployment target
- reworking the application’s readiness architecture
- changing the database provider
- introducing a remote build pipeline in place of the current local-build flow

## Proposed Work

### Track A: Build Determinism

- Add a root `.dockerignore` to exclude irrelevant local artifacts from Docker contexts.
- Pin the workspace pnpm version in the repository and container builds.
- Reduce avoidable package-manager drift in Docker images.

### Track B: Ingress and Readiness Verification

- Proxy `/health` and `/ready` through the web ingress container.
- Normalize proxy-side startup failures into stable readiness-style JSON responses where appropriate.
- Add post-deploy smoke tests in `scripts/deploy.sh` that poll the deployed service until health and readiness succeed or time out.

### Track C: Image Provenance

- Stop treating `:latest` as the only deployment reference.
- Move toward deploy-time image references that are uniquely tied to a single build artifact.

## Acceptance Criteria

- [x] The deploy script fails fast when required local tooling is missing.
- [x] The deploy script verifies the deployed service through its public Cloud Run URL before reporting success.
- [x] The web ingress exposes `/health` and `/ready` to support smoke tests and diagnostics.
- [x] Container builds use a pinned pnpm version instead of whatever release happens to be current.
- [x] A root `.dockerignore` excludes local artifacts that should never enter Docker build context.
- [x] Sidecar startup failures at the ingress boundary surface as stable retryable responses instead of opaque HTML gateway errors.
- [x] Immutable image references are used for deployment instead of relying only on `:latest`.

## Initial Implementation Slice

This issue has been started with the following first-pass focus:

- pin pnpm versioning in repo/container paths
- add a root `.dockerignore`
- expose `/health` and `/ready` through the ingress container
- add post-deploy smoke checks in `scripts/deploy.sh`
- normalize proxy-side startup failures into retryable service-unavailable responses

## Notes

- The environment-tag warning from `gcloud` is informational and not currently a blocker.
- `:latest` is still pushed as an operator convenience alias, but deploy resolution now uses digests.
