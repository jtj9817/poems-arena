#!/bin/bash
# scripts/deploy.sh - Local Build and Push Deployment script for Google Cloud Run

set -e

# Configuration
PROJECT_ID="solheim-project"
REGION="us-west1"
ARTIFACT_REGISTRY="us-west1-docker.pkg.dev/solheim-project/sanctuary"
API_IMAGE="${ARTIFACT_REGISTRY}/api:latest"
WEB_IMAGE="${ARTIFACT_REGISTRY}/web:latest"
SERVICE_ACCOUNT="237062568374-compute@developer.gserviceaccount.com"

echo "🚀 Starting Local Build & Push for Classicist's Sanctuary..."

# 1. Ensure we are in the correct project
gcloud config set project $PROJECT_ID

# 2. Authenticate Docker with Google Artifact Registry
echo "🔐 Authenticating Docker for ${REGION}..."
gcloud auth configure-docker us-west1-docker.pkg.dev --quiet

# 3. Build API Image Locally
echo "🏗️ Building API Image locally..."
docker build \
  --platform linux/amd64 \
  -t $API_IMAGE \
  -f apps/api/Dockerfile .

# 4. Build Web Image Locally
echo "🏗️ Building Web Image locally..."
docker build \
  --platform linux/amd64 \
  -t $WEB_IMAGE \
  --build-arg VITE_API_URL=/api/v1 \
  -f apps/web/Dockerfile .

# 5. Push Images to Artifact Registry
echo "📤 Pushing images to registry..."
docker push $API_IMAGE
docker push $WEB_IMAGE

# 6. Deploy Service via service.yaml
echo "🚀 Deploying to Cloud Run via service.yaml..."
# Replace the service account placeholder and deploy
sed "s/\${SERVICE_ACCOUNT_EMAIL}/$SERVICE_ACCOUNT/g" service.yaml > service.deployed.yaml
gcloud run services replace service.deployed.yaml --region $REGION

echo "✅ Deployment SUCCESSFUL!"
echo "🌐 Service URL: $(gcloud run services describe classicist-sanctuary --region $REGION --format='value(status.url)')"

# Clean up temporary file
rm service.deployed.yaml
