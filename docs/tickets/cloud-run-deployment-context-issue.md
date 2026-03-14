# [BUG] Cloud Run Multi-Container Deployment Blocked by Build Context Limitations

**Date:** 2026-03-08
**Status:** Closed
**Priority:** High
**Assignee:** Unassigned
**Labels:** `devops`, `cloud-run`, `deployment`, `docker`

## Background

The goal was to deploy the Classicist's Sanctuary monorepo (composed of `apps/api` and `apps/web`) to Google Cloud Run using a multi-container (sidecar) architecture, defined via a `docker-compose.yml` file. Cloud Run requires exactly one container to act as the ingress (with published ports), while the other containers in the pod communicate over `localhost`.

We successfully updated the `docker-compose.yml` to satisfy Cloud Run's networking constraints:
- Removed `ports: ['4000:4000']` from the `sanctuary-api` service.
- Set `sanctuary-web` to use `ports: ['8080:80']` as the sole ingress.

## The Issue

Attempting to deploy this configuration natively using Google Cloud tools has repeatedly failed due to issues resolving the build context within the monorepo structure.

Both `gcloud beta run compose up` and `gcloud builds submit` struggle to correctly send the root workspace context to the remote Docker daemon while targeting sub-directory Dockerfiles (`apps/api/Dockerfile` and `apps/web/Dockerfile`). The remote build environment fails to locate the Dockerfiles or the necessary workspace dependencies.

## Plans Attempted

### Attempt 1: `gcloud beta run compose up`

**Strategy:**
Use the `gcloud beta run compose up` command, which allows deploying directly from a `docker-compose.yml` file.

**Execution:**
1. Ran `gcloud beta run compose up docker-compose.yml --allow-unauthenticated`.
2. The command triggered remote builds on Google Cloud Build.

**Result:**
**Failed.** Both the API and Web container builds failed with the error:
`failed to solve: rpc error: code = Unknown desc = failed to solve with frontend dockerfile.v0: failed to read dockerfile: open /var/lib/docker/tmp/.../Dockerfile: no such file or directory`

**Analysis:**
The command parses the `docker-compose.yml` (which has `context: .` and `dockerfile: apps/api/Dockerfile`), uploads the source, but the remote Cloud Build executor fails to locate the Dockerfile at the specified path relative to the uploaded context. Despite attempts to modify `.gcloudignore` to explicitly include the Dockerfiles, the context resolution remained broken. This is a known quirk of `gcloud run compose` when dealing with monorepos where Dockerfiles are not at the root.

### Attempt 2: `cloudbuild.yaml` with `gcloud builds submit`

**Strategy:**
Abandon the `compose up` macro and use a native `cloudbuild.yaml` to explicitly orchestrate the `docker build` commands, then push to Artifact Registry.

**Execution:**
1. Created a `cloudbuild.yaml` that explicitly runs `docker build -t <image> -f apps/api/Dockerfile .`
2. Modified the API and Web Dockerfiles to explicitly `COPY` the `pnpm-lock.yaml` and the `packages/db` workspace dependency, switching from `bun install` to `bunx pnpm i --frozen-lockfile` to ensure proper workspace resolution.
3. Ran `gcloud builds submit --config=cloudbuild.yaml .`

**Result:**
**Failed / Cancelled.** The `sanctuary-api` build failed at the `bunx drizzle-kit generate` step because it could not find `drizzle-kit`, indicating that despite copying `pnpm-lock.yaml`, the `pnpm install` step did not correctly hydrate the workspace dependencies within the Docker build context. Subsequent debugging attempts to adjust the Dockerfile `COPY` commands were aborted to capture this state.

## Results

### Attempt 3: Local Build & Sidecar Deployment (Successful)

**Strategy:**
Build images locally to bypass fragile Cloud Build workspace resolution, push to a known functional region, and use `gcloud beta run compose up` with a pre-configured sidecar networking (Nginx proxy on localhost:4000).

**Execution:**
1.  **Repository Setup:** Created a Docker repository named `sanctuary` in Artifact Registry.
2.  **Image Build:** Built the `api` and `web` images locally using their respective Dockerfiles.
3.  **Networking Fix:** Updated `apps/web/Dockerfile` to include an Nginx proxy that routes `/api/v1` to `http://localhost:4000/api/v1`. This ensures the frontend can communicate with the backend sidecar over the private `localhost` network within the Cloud Run pod.
4.  **Deployment:** Discovered that `us-east1` was blocked by a regional initialization quota (common in newer projects). Successfully deployed the project to `us-west1` (the project's primary active region) using `gcloud beta run compose up`.

**Result:**
**Success.** The service is live at: `https://classicist-sanctuary-lf4is44nra-uw.a.run.app`

**Key Learnings:**
- **Local Builds:** Bypass remote workspace dependency resolution issues in Cloud Build for monorepos.
- **Regional Initialization:** Projects often have a limit on the number of active Cloud Run regions. If `gcloud run compose up` fails with a generic quota error in a new region, switch to a region already hosting active services.
- **Sidecar Connectivity:** In Cloud Run multi-container, services must communicate via `localhost`. The Nginx proxy in the ingress container is the standard way to bridge frontend-to-backend traffic.

**Status:** Resolved
**Resolution Date:** 2026-03-08

---

## Closure Note

**Closed:** 2026-03-14

Header status corrected to match the resolution already documented above. The ticket was resolved on 2026-03-08 via local builds + sidecar deployment to `us-west1`. Header had been left as "Open" in error.