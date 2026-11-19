# syntax=docker/dockerfile:1.7
# Pattern server image. Build from the repository root (the server needs the
# Rust engine, the design-lint package and the levels/interviews data):
#   docker build -f apps/server/Dockerfile -t pattern-server .
# or: docker compose build server

# ---- 1. Rust engine -> WebAssembly package for Node ----------------------
FROM rust:1-slim-bookworm AS wasm
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates pkg-config libssl-dev \
 && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo install wasm-pack --locked
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    wasm-pack build crates/engine-wasm --target nodejs --release \
      --out-dir pkg-node --out-name pattern_engine_wasm

# ---- 2. Node build: install, prisma generate, tsc ------------------------
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
# manifests first so the dependency layer is cached across code changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/design-lint/package.json packages/design-lint/
COPY --from=wasm /src/crates/engine-wasm/pkg-node crates/engine-wasm/pkg-node
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter server...
COPY packages/design-lint packages/design-lint
COPY apps/server apps/server
RUN pnpm --filter server build

# ---- 3. Runtime ----------------------------------------------------------
FROM node:24-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# read by LevelsService / InterviewsService (resolved relative to dist/)
COPY --chown=node:node levels ./levels
COPY --chown=node:node interviews ./interviews
USER node
WORKDIR /app/apps/server
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# apply pending migrations, then start
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
