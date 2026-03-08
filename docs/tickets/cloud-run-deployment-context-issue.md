# [BUG] Cloud Run Multi-Container Deployment Blocked by Build Context Limitations

**Date:** 2026-03-08
**Status:** Open
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

## Recommended Next Steps

1. **Local Build & Push:** Instead of relying on Google Cloud Build to construct the images from source, build the images locally using `docker-compose build`, tag them, and push them directly to Google Artifact Registry. 
2. **Deploy Pre-Built Images:** Once the images are in the registry, update the `docker-compose.yml` to use `image: <registry-url>` instead of `build:`. Then, use `gcloud beta run compose up` or convert to a native `service.yaml` and deploy using `gcloud run deploy`. This entirely bypasses the fragile remote build context issues.