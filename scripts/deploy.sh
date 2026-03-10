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

# Configuration
PROJECT_ID="solheim-project"
REGION="us-west1"
SERVICE_NAME="classicist-sanctuary"
ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/solheim-project/sanctuary"
API_IMAGE="${ARTIFACT_REGISTRY}/api:latest"
WEB_IMAGE="${ARTIFACT_REGISTRY}/web:latest"
SERVICE_ACCOUNT="237062568374-compute@developer.gserviceaccount.com"
DOCKER_BUILD_PROGRESS="${DOCKER_BUILD_PROGRESS:-plain}"
DEPLOY_VERIFY_ATTEMPTS="${DEPLOY_VERIFY_ATTEMPTS:-20}"
DEPLOY_VERIFY_SLEEP_SECONDS="${DEPLOY_VERIFY_SLEEP_SECONDS:-3}"

echo "🚀 Starting Local Build & Push for Classicist's Sanctuary..."

require_command gcloud
require_command docker
require_command curl

# 1. Ensure we are in the correct project
gcloud config set project "$PROJECT_ID"

# 2. Authenticate Docker with Google Artifact Registry
echo "🔐 Authenticating Docker for ${REGION}..."
gcloud auth configure-docker us-west1-docker.pkg.dev --quiet

# 3. Build API Image Locally
echo "🏗️ Building API Image locally..."
docker build \
  --progress "$DOCKER_BUILD_PROGRESS" \
  --platform linux/amd64 \
  -t "$API_IMAGE" \
  -f apps/api/Dockerfile .

# 4. Build Web Image Locally
echo "🏗️ Building Web Image locally..."
docker build \
  --progress "$DOCKER_BUILD_PROGRESS" \
  --platform linux/amd64 \
  -t "$WEB_IMAGE" \
  --build-arg VITE_API_URL=/api/v1 \
  -f apps/web/Dockerfile .

# 5. Push Images to Artifact Registry
echo "📤 Pushing images to registry..."
docker push "$API_IMAGE"
docker push "$WEB_IMAGE"

# 6. Deploy Service via service.yaml
echo "🚀 Deploying to Cloud Run via service.yaml..."
# Replace the service account placeholder and deploy
sed "s/\${SERVICE_ACCOUNT_EMAIL}/$SERVICE_ACCOUNT/g" service.yaml > service.deployed.yaml
gcloud run services replace service.deployed.yaml --region "$REGION"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

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
