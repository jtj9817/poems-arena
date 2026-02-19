# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy root workspace manifests
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/api/package.json ./apps/api/package.json

# Install all workspace deps
RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Generate drizzle migrations
WORKDIR /app/apps/api
RUN bunx drizzle-kit generate

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS runner

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

WORKDIR /app/apps/api

EXPOSE 4000

CMD ["bun", "run", "src/index.ts"]
