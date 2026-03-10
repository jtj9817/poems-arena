#!/bin/bash
# scripts/deploy.sh - Local Build and Push Deployment script for Google Cloud Run

set -euo pipefail

cleanup() {
  rm -f service.deployed.yaml
}

trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1" >&2
    exit 1
  fi
}

wait_for_http_200() {
  local url="$1"
  local label="$2"
  local attempts="${3:-15}"
  local sleep_seconds="${4:-2}"
  local attempt
  local status

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 "$url" || true)"

    if [[ "$status" == "200" ]]; then
      echo "✅ ${label} responded with HTTP 200"
      return 0
    fi

    echo "⏳ Waiting for ${label} (${attempt}/${attempts}) — HTTP ${status:-000}"
    sleep "$sleep_seconds"
  done

  echo "❌ ${label} failed to reach HTTP 200: $url" >&2
  return 1
}

resolve_repo_digest() {
  local image_with_tag="$1"
  local image_repo="$2"
  local digest_ref

  digest_ref="$(
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_with_tag" \
      | grep -E "^${image_repo}@sha256:[a-f0-9]{64}$" \
      | head -n 1 \
      || true
  )"

  if [[ -z "$digest_ref" ]]; then
    echo "❌ Could not resolve digest for ${image_with_tag}" >&2
    exit 1
  fi

  printf '%s\n' "$digest_ref"
}

# Configuration
PROJECT_ID="solheim-project"
REGION="us-west1"
SERVICE_NAME="classicist-sanctuary"
ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/solheim-project/sanctuary"
API_IMAGE_REPO="${ARTIFACT_REGISTRY}/api"
WEB_IMAGE_REPO="${ARTIFACT_REGISTRY}/web"
SERVICE_ACCOUNT="237062568374-compute@developer.gserviceaccount.com"
DOCKER_BUILD_PROGRESS="${DOCKER_BUILD_PROGRESS:-plain}"
DEPLOY_VERIFY_ATTEMPTS="${DEPLOY_VERIFY_ATTEMPTS:-20}"
DEPLOY_VERIFY_SLEEP_SECONDS="${DEPLOY_VERIFY_SLEEP_SECONDS:-3}"
IMAGE_TAG="${IMAGE_TAG:-}"

echo "🚀 Starting Local Build & Push for Classicist's Sanctuary..."

require_command gcloud
require_command docker
require_command curl
require_command awk
require_command grep

if command -v git >/dev/null 2>&1; then
  GIT_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || true)"
else
  GIT_SHA=""
fi

if [[ -z "${IMAGE_TAG:-}" ]]; then
  IMAGE_TAG="${GIT_SHA:-$(date +%Y%m%d%H%M%S)}"
fi

API_IMAGE_TAGGED="${API_IMAGE_REPO}:${IMAGE_TAG}"
WEB_IMAGE_TAGGED="${WEB_IMAGE_REPO}:${IMAGE_TAG}"
API_IMAGE_LATEST="${API_IMAGE_REPO}:latest"
WEB_IMAGE_LATEST="${WEB_IMAGE_REPO}:latest"

echo "🏷️ Using image tag: ${IMAGE_TAG}"

# 1. Authenticate Docker with Google Artifact Registry
echo "🔐 Authenticating Docker for ${REGION}..."
gcloud auth configure-docker us-west1-docker.pkg.dev --quiet

# 2. Build API Image Locally
echo "🏗️ Building API Image locally..."
docker build \
  --progress "$DOCKER_BUILD_PROGRESS" \
  --platform linux/amd64 \
  -t "$API_IMAGE_TAGGED" \
  -f apps/api/Dockerfile .

# 3. Build Web Image Locally
echo "🏗️ Building Web Image locally..."
docker build \
  --progress "$DOCKER_BUILD_PROGRESS" \
  --platform linux/amd64 \
  -t "$WEB_IMAGE_TAGGED" \
  --build-arg VITE_API_URL=/api/v1 \
  -f apps/web/Dockerfile .

# Keep :latest as a convenience alias, but deploy using immutable digests.
docker tag "$API_IMAGE_TAGGED" "$API_IMAGE_LATEST"
docker tag "$WEB_IMAGE_TAGGED" "$WEB_IMAGE_LATEST"

# 4. Push Images to Artifact Registry
echo "📤 Pushing images to registry..."
docker push "$API_IMAGE_TAGGED"
docker push "$WEB_IMAGE_TAGGED"
docker push "$API_IMAGE_LATEST"
docker push "$WEB_IMAGE_LATEST"

API_IMAGE_REF="$(resolve_repo_digest "$API_IMAGE_TAGGED" "$API_IMAGE_REPO")"
WEB_IMAGE_REF="$(resolve_repo_digest "$WEB_IMAGE_TAGGED" "$WEB_IMAGE_REPO")"

echo "📌 API image ref: ${API_IMAGE_REF}"
echo "📌 Web image ref: ${WEB_IMAGE_REF}"

# 5. Deploy Service via service.yaml
echo "🚀 Deploying to Cloud Run via service.yaml..."
# Replace placeholders and deploy.
awk \
  -v service_account="$SERVICE_ACCOUNT" \
  -v api_image_ref="$API_IMAGE_REF" \
  -v web_image_ref="$WEB_IMAGE_REF" \
  '{
    gsub(/\$\{SERVICE_ACCOUNT_EMAIL\}/, service_account);
    gsub(/\$\{API_IMAGE_REF\}/, api_image_ref);
    gsub(/\$\{WEB_IMAGE_REF\}/, web_image_ref);
    print;
  }' \
  service.yaml > service.deployed.yaml
gcloud run services replace \
  service.deployed.yaml \
  --project "$PROJECT_ID" \
  --region "$REGION"

SERVICE_URL="$(
  gcloud run services describe \
    "$SERVICE_NAME" \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.url)'
)"

echo "🔎 Verifying deployed service..."
wait_for_http_200 \
  "${SERVICE_URL}/health" \
  "service health" \
  "$DEPLOY_VERIFY_ATTEMPTS" \
  "$DEPLOY_VERIFY_SLEEP_SECONDS"
wait_for_http_200 \
  "${SERVICE_URL}/ready" \
  "service readiness" \
  "$DEPLOY_VERIFY_ATTEMPTS" \
  "$DEPLOY_VERIFY_SLEEP_SECONDS"

echo "✅ Deployment SUCCESSFUL!"
echo "🌐 Service URL: ${SERVICE_URL}"
