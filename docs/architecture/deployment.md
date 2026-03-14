# Deployment — Cloud Run

This document describes the production deployment model for Poems Arena and how to ship new versions.

---

## Architecture Overview

The application runs as a **multi-container Cloud Run service** in `us-west1`:

- **`sanctuary-web`** — nginx container serving the static SPA. This is the ingress container; it receives public traffic on port 80 and proxies `/api/v1` requests to the API sidecar over `localhost:4000`.
- **`sanctuary-api`** — Bun + Hono API container. Runs as a sidecar alongside the web container, not directly exposed to the public internet.

Both containers share the same Cloud Run instance. Secrets (`LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`) are injected into the API container by Cloud Run's Secret Manager integration.

The service descriptor is `service.yaml` at the repo root. It is a Knative serving spec and is deployed via `gcloud run services replace`.

---

## Deploying

There are two supported deployment paths: local build and Cloud Build.

### Option A: Local Build and Push (`scripts/deploy.sh`)

For developer-triggered deployments from a local machine.

**Prerequisites:**

- `gcloud` CLI authenticated with the `solheim-project` project
- `docker` with buildx support (targets `linux/amd64`)
- Write access to `us-west1-docker.pkg.dev/solheim-project/sanctuary`

**Run:**

```bash
bash scripts/deploy.sh
```

**What it does:**

1. Guards against uncommitted changes (clean tree required).
2. Authenticates Docker with the Artifact Registry.
3. Auto-increments the minor version via `bump-version.ts --deploy-mode` (creates a `chore(release): vX.Y` commit and tag), unless `IMAGE_TAG` is explicitly set.
4. Builds the API image from `apps/api/Dockerfile` with `--build-arg BUILD_VERSION=<version>`.
5. Builds the web image from `apps/web/Dockerfile` with `--build-arg VITE_API_URL=/api/v1`.
6. Tags both images with the short git SHA (after any bump commit) and also as `:latest`.
7. Pushes all tags to Artifact Registry.
8. Resolves the immutable `sha256` digest of each pushed image.
9. Substitutes placeholders in `service.yaml` → `service.deployed.yaml` (including `${APP_VERSION}` revision label) and runs `gcloud run services replace`.
10. Polls `GET /health` and `GET /ready` until both return HTTP 200, or fails after configurable retries.
11. Pushes the version commit and tag to the remote after successful verification (only when a bump occurred).

**Override options (env vars):**

| Variable | Default | Description |
| --- | --- | --- |
| `IMAGE_TAG` | short git SHA | Override the image tag; **skips auto version bump**. If set to a git SHA, you must be checked out on that commit. |
| `DOCKER_BUILD_PROGRESS` | `plain` | Docker build progress format (`plain` or `auto`) |
| `DEPLOY_VERIFY_ATTEMPTS` | `20` | Health/readiness polling attempts |
| `DEPLOY_VERIFY_SLEEP_SECONDS` | `3` | Seconds between polling attempts |

### Option B: Cloud Build (`cloudbuild.yaml`)

Triggered automatically by Cloud Build on the `main` branch (CI path). Cloud Build handles auth, image push, and `gcloud run services replace` without local tooling.

**Note on `service.yaml` placeholders:** Cloud Build uses `sed` to substitute `${SERVICE_ACCOUNT_EMAIL}`. `scripts/deploy.sh` uses `awk` to substitute `${SERVICE_ACCOUNT_EMAIL}`, `${API_IMAGE_REF}`, `${WEB_IMAGE_REF}`, and `${APP_VERSION}`. The deploy script deploys using immutable digest refs; Cloud Build deploys using the `:latest` tag. Cloud Build does not auto-increment versions.

---

## `service.yaml` Structure

The service spec (`service.yaml`) declares:

- **`gen2` execution environment** — required for sidecar support.
- **Two containers:** `sanctuary-api` (sidecar, no external port) and `sanctuary-web` (ingress, port 80).
- **Secrets:** `LIBSQL_URL` and `LIBSQL_AUTH_TOKEN` are pulled from Cloud Run Secret Manager (`secretKeyRef`). These must be created in the project before the first deploy.
- **Service account:** `237062568374-compute@developer.gserviceaccount.com`
- **Resource limits:** API: 1 CPU / 2 GiB. Web: 1 CPU / 1 GiB.
- **Container concurrency:** 80 per instance.
- **Timeout:** 300 seconds.

Placeholders in `service.yaml` are replaced at deploy time:

| Placeholder | Substituted with |
| --- | --- |
| `${SERVICE_ACCOUNT_EMAIL}` | Compute service account email |
| `${API_IMAGE_REF}` | Immutable digest ref for the API image |
| `${WEB_IMAGE_REF}` | Immutable digest ref for the web image |
| `${APP_VERSION}` | Semantic version (e.g., `1.1`) — set as a Cloud Run revision label |

---

## Version Bumping

The version string (`x.y` format) appears in `package.json`, `apps/web/metadata.json`, the `GET /health` response, and the Cloud Run revision label `app-version`.

**Automatic (on deploy):** Each `scripts/deploy.sh` invocation auto-increments the minor version before building images. The version is baked into the API Docker image via the `BUILD_VERSION` build arg and exposed as the `APP_VERSION` environment variable at runtime. The version commit and tag are pushed only after the deploy is verified healthy.

**Manual (standalone):** For explicit major bumps or out-of-band version control:

```bash
# Increment minor version (x.y → x.(y+1))
pnpm version:minor

# Increment major version (x.y → (x+1).0)
pnpm version:major
```

The standalone `--minor` / `--major` flags are gated on a successful Cloud Build run on `main` via `gcloud builds list`. Use `--skip-ci-check` in environments without gcloud. When `y >= 10`, a minor bump auto-rolls to the next major version.

---

## Rollback

To roll back to a previous version, redeploy the known-good code. The simplest safe approach is to check out the desired commit (or tag) and run the deploy script (this rebuilds, pushes, and deploys images for that exact code).

```bash
git checkout <previous-git-sha-or-tag>
bash scripts/deploy.sh
```

If you want to keep the image tag pinned to a specific commit SHA and skip the auto-bump, you can set `IMAGE_TAG` to that SHA (the script will fail fast if it does not match `HEAD`):

```bash
git checkout <previous-git-sha>
IMAGE_TAG=<previous-git-sha> bash scripts/deploy.sh
```

To redeploy an existing known-good image digest without rebuilding, update `service.yaml` directly with the known-good digest refs and run:

```bash
gcloud run services replace service.yaml --region us-west1
```

No database migrations are run during deployment. Schema changes are applied separately via `pnpm --filter @sanctuary/api db:push` or `db:migrate` against the live Turso database.

---

## Cold-Start Behavior

Cloud Run scales to zero when idle. On cold boot:

1. The nginx and Bun containers start simultaneously.
2. The API starts a background DB warm-up (`startDbWarmup`) — issues `SELECT 1` against Turso with up to 4 retries.
3. All `/api/v1/*` data routes are blocked by `ensureDbReady()` middleware until warm-up succeeds.
4. `GET /ready` reports warm-up status — Cloud Run can optionally use this as a startup probe.
5. The Home page handles `503 SERVICE_UNAVAILABLE` responses from the API with a client-side retry loop (4 attempts, escalating delays).

See `docs/backend/README.md` for full DB readiness infrastructure documentation.
