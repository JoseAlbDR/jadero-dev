# syntax=docker/dockerfile:1
#
# The web image (WP-7, ADR-049 restating ADR-048 "Images"; ADR-026; docs/learning/wp-7.md D1 to D5).
# Build from the repository root: docker build -f apps/web/Dockerfile -t jadero-web:dev .
#
# One process: the Next.js standalone server (ADR-026), which traces and copies only the files and
# dependencies the server needs, so there is no `pnpm deploy` here.
# Configuration comes only from the environment at run time (ADR-043): SITE_URL, CONTENT_API_URL and
# CSP_MODE are read when the server starts or per request; the image bakes none of them in.

# Node 24 LTS (ADR-042), Debian 13 slim, pinned by the digest of the multi-architecture index (D3).
# The Node version must equal .nvmrc; scripts/docker-base-image.test.mjs fails when they drift.
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

# ---- build: the whole workspace and its toolbox; none of it reaches the runtime image (D1) ----
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    NEXT_TELEMETRY_DISABLED=1
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
# SITE_URL is a neutral placeholder that only satisfies the config check when `next build` loads the
# modules; the pages read the real value at run time. The `.invalid` top-level domain never
# resolves (RFC 2606), so a leak would show up as a broken link, never as someone else's site.
# The build copies `.next/static` and `public` next to server.js (scripts/copy-standalone-assets.mjs).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --offline --frozen-lockfile --ignore-scripts \
 && SITE_URL=https://build.invalid pnpm turbo run build --filter=@jadero/web...

# ---- runtime: Node and the standalone server only ----
FROM ${NODE_IMAGE} AS runtime
# The server never runs a package manager: removing them drops npm's own dependencies, where the
# scanner finds HIGH vulnerabilities, from what a compromised process could run.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
WORKDIR /app
# Owned by root and only readable by `node`: the process cannot rewrite its own code (D4). The
# standalone folder mirrors the repository: its node_modules at the root, server.js in apps/web.
COPY --from=build --chown=root:root /repo/apps/web/.next/standalone /app
# Next's server cache (fetch cache, optimized images) is on disk under .next/cache: the one folder
# the process may write. Under a read-only root filesystem Compose mounts a size-capped tmpfs over
# it (D4); the empty folder owned by `node` keeps a plain `docker run` working too.
RUN mkdir /app/apps/web/.next/cache && chown node:node /app/apps/web/.next/cache
# HOSTNAME: Docker sets it to the container id and the standalone server binds to it, which would
# leave the server unreachable on 127.0.0.1 (and so the healthcheck). 3000 is Next's default port,
# the one apps/web/.env.example and `pnpm dev` use.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
USER node
EXPOSE 3000
# Readiness, not liveness (D5): safe because Docker never restarts an unhealthy container. web has
# no health route; the server renders /robots.txt itself, without the content API, and the locale
# proxy skips it. Node's own fetch, since the slim image has no curl or wget.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --start-interval=2s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/robots.txt').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Exec form: Node is process 1 and gets SIGTERM directly, so the server closes cleanly.
CMD ["node", "apps/web/server.js"]
