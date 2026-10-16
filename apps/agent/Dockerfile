# syntax=docker/dockerfile:1
#
# The agent image (WP-7, ADR-049 restating ADR-048 "Images"; docs/learning/wp-7.md D1 to D5).
# Build from the repository root: docker build -f apps/agent/Dockerfile -t jadero-agent:dev .
#
# One image for every agent process type (D2); the command picks the process:
#   server (default)  node --import @jadero/platform-nest/instrumentation dist/main.js
#   agent-consumer    node --import @jadero/platform-nest/instrumentation dist/consumer.js
#   agent-migrate     node dist/migrate.js   (one-off before the server starts; no healthcheck)
# Configuration comes only from the environment at run time (ADR-043): no secret is ever baked in.

# Node 24 LTS (ADR-042), Debian 13 slim, pinned by the digest of the multi-architecture index (D3).
# The Node version must equal .nvmrc; scripts/docker-base-image.test.mjs fails when they drift.
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

# ---- build: the whole workspace and its toolbox; none of it reaches the runtime image (D1) ----
FROM ${NODE_IMAGE} AS build
# Copy packages out of the store, never clone or hard-link them. The store is a cache mount, another
# filesystem than the layers, so they are copied anyway. pnpm's default (`auto`) picks the method in
# each worker from the first package it imports: when `pnpm deploy` meets a workspace package first
# (a layer file, which a reflink filesystem such as btrfs can clone into /out) it settles on clone,
# and the next package from the store fails with EXDEV. Seen on a fresh builder with the layer cache
# imported and the store mount empty (2 of 5 builds); copy removes the race.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    pnpm_config_package_import_method=copy
WORKDIR /repo

# Layers ordered by change rate: the lockfile changes about once a week, the sources on every commit.
# `pnpm fetch` reads only the lockfile, so this download layer survives every source edit. The store
# (pnpm's default path) is a BuildKit cache mount: kept between builds, never part of a layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    corepack enable && pnpm fetch --frozen-lockfile

COPY . .
# --ignore-scripts: every dependency build script is already off (allowBuilds in pnpm-workspace.yaml),
# and the root `prepare` script (lefthook install) needs a git checkout the context does not carry.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile --ignore-scripts \
 && pnpm turbo run build --filter=@jadero/agent... \
 && pnpm --filter @jadero/agent --prod deploy /out

# ---- runtime: Node, the compiled service and its production dependencies only ----
FROM ${NODE_IMAGE} AS runtime
# The services never run a package manager: removing them drops npm's own dependencies, where the
# scanner finds HIGH vulnerabilities, from what a compromised process could run.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
# Owned by root and only readable by `node`: the process cannot rewrite its own code (D4).
COPY --from=build --chown=root:root /out /app
# HOST: the service config defaults to 127.0.0.1 so `pnpm dev` stays off the LAN; in a container
# the Compose network and the published port need every interface (the healthcheck's 127.0.0.1 is
# one of them).
ENV NODE_ENV=production \
    HOST=0.0.0.0
USER node
EXPOSE 3002
# Readiness, not liveness (D5): safe because Docker never restarts an unhealthy container. Node's
# own fetch, since the slim image has no curl or wget. PORT is required by the service config.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --start-interval=2s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Exec form: Node is process 1 and gets SIGTERM directly, so the shutdown hooks run (WP-3).
CMD ["node", "--import", "@jadero/platform-nest/instrumentation", "dist/main.js"]
