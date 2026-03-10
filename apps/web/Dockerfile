# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

ARG PNPM_VERSION=10.30.2

# Install a pinned pnpm version so container builds match workspace expectations.
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate

WORKDIR /app

# Copy root workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/web/package.json ./apps/web/package.json

# Install only the web workspace from within its package directory.
RUN cd apps/web && pnpm install \
  --config.recursive-install=false \
  --frozen-lockfile \
  --fetch-retries=5 \
  --fetch-timeout=120000

# Copy source
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build arg for baking API URL into the static bundle
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /app/apps/web
RUN pnpm build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# SPA fallback & API proxy — serve index.html for all routes, proxy API and readiness
# paths to the localhost sidecar, and normalize sidecar startup failures into
# a stable JSON 503 payload for browser retry logic and smoke tests.
RUN cat > /etc/nginx/conf.d/default.conf <<'NGINX_CONF'
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location /api/v1/ {
    proxy_pass http://localhost:4000/api/v1/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 2s;
    proxy_read_timeout 30s;
    proxy_intercept_errors on;
    error_page 502 503 504 = @api_unavailable;
  }

  location = /health {
    proxy_pass http://localhost:4000/health;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 2s;
    proxy_read_timeout 15s;
    proxy_intercept_errors on;
    error_page 502 503 504 = @api_unavailable;
  }

  location = /ready {
    proxy_pass http://localhost:4000/ready;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_connect_timeout 2s;
    proxy_read_timeout 15s;
    proxy_intercept_errors on;
    error_page 502 503 504 = @api_unavailable;
  }

  location @api_unavailable {
    default_type application/json;
    return 503 '{"error":"Archive is not ready","code":"SERVICE_UNAVAILABLE"}';
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
NGINX_CONF

RUN nginx -t

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
