# VER-001 — Application Version Incrementing System

**Ticket Type:** Infrastructure / Developer Experience
**Status:** Closed
**Priority:** Medium
**Assignee:** Unassigned
**Labels:** versioning, ci-cd, cloud-build, scripts, api, web, frontend

---

## Context

The root `package.json` carries `"version": "0.0.0"` and `apps/web/metadata.json` has no version field. There is no mechanism to increment the version, propagate it to consumers, or tie a version bump to a verified pipeline run. The `GET /health` endpoint returns only `{ status: "ok" }` with no version signal.

The CI/CD pipeline lives in `cloudbuild.yaml` (Google Cloud Build): it builds both Docker images and deploys the Cloud Run service via `service.yaml`. There is no GitHub Actions workflow. The pipeline does not currently produce or consume a version artifact.

---

## Objective

Implement a version incrementing system that:

- uses an `x.y` format (no patch component)
- rolls `y` over to the next major when `y` reaches `10` (i.e., `1.10` → `2.0`)
- requires a successful Cloud Build pipeline run as a precondition before any version bump is accepted
- propagates the canonical version to all consumers from a single source of truth
- produces an annotated git tag for each release
- displays the current version as a visible indicator on the application homepage

---

## Scope

**In scope:**

- `scripts/bump-version.ts` — CLI bump script with pipeline precondition check
- `package.json` — single source of truth for the version value
- `apps/web/metadata.json` — receives the version at bump time
- `apps/api/src/routes/health.ts` (or equivalent) — exposes version in `GET /health` response
- `cloudbuild.yaml` — documents the pipeline whose success gates versioning
- git tag `vX.Y` created and pushed by the bump script

**Out of scope:**

- Per-package independent versioning (this is a product monorepo, not a library ecosystem)
- Publishing packages to npm or any registry
- Automated version bumps triggered inside Cloud Build (auth complexity; bump remains a deliberate local action)
- Semantic-release or Changesets tooling adoption
- API URL prefix changes (`/api/v1/` is a separate compatibility era, not coupled to app semver)
- version badge placement outside the homepage (e.g. nav bar, footer across all pages)

---

## Version Format Rules

| Situation | Bump type | Example |
| :--- | :--- | :--- |
| Non-breaking feature, fix, or improvement | `--minor` | `1.3` → `1.4` |
| Breaking API contract change, destructive schema migration, or removed capability | `--major` | `1.9` → `2.0` |
| `y` has reached `10` and a minor bump is requested | Auto-roll to major | `1.10` → `2.0` |

The `y` value is allowed to be `0` through `10` inclusive. A minor bump when `y === 10` automatically becomes a major bump — the script enforces this without requiring the caller to do the math.

---

## Design Decisions

| Decision | Choice | Rationale |
| :--- | :--- | :--- |
| Single version for all packages | Yes | Product monorepo; internal packages are never published independently |
| Source of truth | Root `package.json` `"version"` field | Already present; tooling knows how to read it |
| `y` ceiling | `10` | Gives a natural cadence before a major bump; simple to reason about |
| Patch component | Omitted | Simplifies the model; fixes and features both land as minor increments |
| CI/CD gate | Query last Cloud Build run on `main` via `gcloud` | Keeps the bump script local and auditable without embedding git auth in Cloud Build |
| Git tag format | `vX.Y` (annotated) | Conventional; visible in `git log --tags` |
| Version in `/health` | Added as `"version"` field | Low-overhead observability signal; no schema impact |

---

## Implementation Plan

### Phase 1 — Bump Script (`scripts/bump-version.ts`)

#### Task 1.1 — Read and parse current version

Read the `"version"` field from root `package.json`. Parse it as `x.y` (two integers separated by a dot). Reject any value that does not match this pattern and exit with a clear error.

#### Task 1.2 — Validate CI/CD precondition

Before applying any bump, call:

```bash
gcloud builds list \
  --filter="substitutions.BRANCH_NAME=main AND status=SUCCESS" \
  --format="value(id,startTime)" \
  --limit=1
```

If no successful build is found, print a descriptive error and exit non-zero. The caller must resolve the failing pipeline before retrying. Accept an optional `--skip-ci-check` flag for local development environments where `gcloud` is not configured, but require explicit opt-in.

#### Task 1.3 — Compute next version

Apply the `x.y` increment rules:

```
if flag is --major:
    next = (x + 1).0

if flag is --minor:
    if y === 10:
        next = (x + 1).0   # auto-roll
    else:
        next = x.(y + 1)
```

Print the transition (`1.3 → 1.4`) before writing anything.

#### Task 1.4 — Write version to consumers

In order:

1. Update `"version"` in root `package.json`
2. Add or update `"version"` in `apps/web/metadata.json`

Both writes must succeed atomically (write to temp, rename, or bail out on first failure).

#### Task 1.5 — Commit and tag

Stage only the two modified files, commit with the message `chore(release): vX.Y`, then create an annotated git tag:

```bash
git tag -a vX.Y -m "Release vX.Y"
```

Print the tag name and remind the caller to push: `git push && git push --tags`.

Do not push automatically — the caller reviews the diff first.

---

### Phase 2 — Expose version in `GET /health`

#### Task 2.1 — Read version in API at startup

At API startup, read `"version"` from the root `package.json` (resolvable at runtime via relative path from the app entrypoint, or baked in via a generated constant at build time). Store it as a module-level constant.

#### Task 2.2 — Include version in health response

Update the `GET /health` handler to return:

```json
{ "status": "ok", "version": "1.4" }
```

The version field must never cause the health check to fail; if the version cannot be resolved, return `"version": "unknown"`.

---

### Phase 3 — `cloudbuild.yaml` Documentation Step

#### Task 3.1 — Add a comment block to `cloudbuild.yaml`

Add a comment block at the top of `cloudbuild.yaml` that documents:

- the pipeline is the required precondition for any `bump-version` run
- the bump script queries this pipeline's success status before writing any version change
- how to invoke the bump script after a successful build

This keeps the contract visible to anyone reading the deploy config. No executable step is added to the pipeline itself.

---

### Phase 4 — Homepage Version Indicator

#### Task 4.1 — Read version at build time

Import the version from `apps/web/metadata.json` (written by the bump script) in the web app. Because `metadata.json` is a static JSON file co-located with the frontend source, it can be imported directly in the component without a runtime fetch.

#### Task 4.2 — Render version badge on the homepage

Add a small, unobtrusive version label to `apps/web/pages/Home.tsx`. Placement should be in a low-attention area of the page (e.g. bottom of the hero section or inline with the page footer region) so it does not compete with primary content.

Requirements:
- Display the value as `v{x.y}` (e.g. `v1.4`)
- Styled as secondary/muted text — not a prominent heading
- Must not render if the version value is absent or malformed (fail silently)

#### Task 4.3 — Keep the indicator homepage-only

The version badge lives exclusively on `Home.tsx`. It does not appear in the global `Layout.tsx`, the nav bar, or any other page. This is a soft informational signal for users landing on the root URL, not a persistent chrome element.

---

### Phase 5 — Root `pnpm` Script Wiring

#### Task 5.1 — Add `version:minor` and `version:major` scripts

Add to root `package.json` `"scripts"`:

```json
"version:minor": "bun scripts/bump-version.ts --minor",
"version:major": "bun scripts/bump-version.ts --major"
```

These give a consistent entry point regardless of how the caller invokes Bun directly.

---

## File Summary

| File | Action | Notes |
| :--- | :--- | :--- |
| `scripts/bump-version.ts` | Create | Core bump script: parse, validate CI, compute, write, commit, tag |
| `package.json` | Modify | Add `version:minor` and `version:major` scripts |
| `apps/web/metadata.json` | Modify | Add `"version"` field (maintained by bump script going forward) |
| `apps/web/pages/Home.tsx` | Modify | Add muted `v{x.y}` version badge in low-attention area |
| `apps/api/src/routes/health.ts` (or `index.ts`) | Modify | Include `"version"` in `GET /health` response |
| `cloudbuild.yaml` | Modify | Add precondition documentation comment block |

---

## Execution Order

1. Write and validate `scripts/bump-version.ts` locally (dry-run against current version).
2. Update `GET /health` to include version.
3. Add version badge to `apps/web/pages/Home.tsx` reading from `metadata.json`.
4. Add pnpm scripts to root `package.json`.
5. Add documentation comment to `cloudbuild.yaml`.
6. Run a first bump (`pnpm version:minor`) after the next successful Cloud Build to exercise the full flow end-to-end, then verify the badge reflects the new version.

---

## Edge Cases to Handle

1. **`y` auto-roll on minor:** `x.10` + `--minor` must silently produce `(x+1).0`, not `x.11`.
2. **Malformed version in `package.json`:** Script must detect and reject a value that does not match `^\d+\.\d+$` before touching any file.
3. **No recent successful build:** Script exits before writing any file. Version is unchanged.
4. **`gcloud` not installed or not authenticated:** `--skip-ci-check` allows local development use; must print a warning when used.
5. **Uncommitted working tree:** Script should warn (but not hard-fail) if there are unstaged changes at bump time, so the version commit is clean.
6. **Version unknown at API startup:** `GET /health` degrades to `"version": "unknown"` rather than throwing or returning a non-200.
7. **Missing or malformed version in `metadata.json`:** The homepage badge renders nothing rather than displaying `"v0.0.0"` or an error string.

---

## Validation Plan

1. **Bump script unit behaviour:** run `bun scripts/bump-version.ts --minor --skip-ci-check` against a known version and assert the correct output files and tag.
2. **Roll-over:** manually set `"version": "1.10"` in `package.json`, run `--minor`, confirm result is `2.0`.
3. **CI gate:** without `--skip-ci-check`, confirm the script exits non-zero when no successful Cloud Build run exists for `main`.
4. **Health endpoint:** call `GET /health` and confirm the response contains a `"version"` field matching the value in `package.json`.
5. **Homepage badge:** load the homepage and confirm a `v{x.y}` label is visible with muted styling; confirm it is absent on all other pages.
6. **Git artifacts:** confirm annotated tag `vX.Y` exists after bump and that the commit message matches `chore(release): vX.Y`.

---

## Acceptance Criteria

- [x] `scripts/bump-version.ts` correctly increments `x.y` for both `--minor` and `--major` flags.
- [x] `y` auto-rolls to the next major when it would exceed `10`.
- [x] A successful Cloud Build run on `main` is required before any version is written (bypassed only by explicit `--skip-ci-check`).
- [x] Root `package.json` is the single source of truth; `apps/web/metadata.json` and the API health response derive from it.
- [x] Each bump produces an annotated git tag `vX.Y` and a commit `chore(release): vX.Y`.
- [x] `GET /health` returns `"version"` alongside `"status"`.
- [x] The homepage displays a muted `v{x.y}` badge sourced from `apps/web/metadata.json`; it renders nothing if the version is absent or malformed.
- [x] The version badge does not appear on any page other than the homepage.
- [x] `pnpm version:minor` and `pnpm version:major` invoke the script from the repo root.

---

## Resolution

**Closed:** 2026-03-14

All acceptance criteria verified against the codebase:
- `scripts/bump-version.ts` exists with `--minor`, `--major`, `--skip-ci-check`, and `--deploy-mode` flags.
- `package.json` carries `"version": "1.4"` with `version:minor` and `version:major` scripts.
- `apps/web/metadata.json` carries `"version": "1.4"`.
- `apps/api/src/index.ts` line 57 returns `{ status: 'ok', version: appVersion }` from `GET /health`.
- `apps/web/pages/Home.tsx` renders `v{appVersion}` at `id="home-version-indicator"` sourced from `metadata.json`.
- `cloudbuild.yaml` contains the precondition documentation comment block.
- Git history confirms the bump script has been exercised: commits `chore(release): v1.2`, `v1.3`, `v1.4`.
