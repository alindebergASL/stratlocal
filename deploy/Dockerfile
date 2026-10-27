# syntax=docker/dockerfile:1

# Two stages. The first builds; the second carries only what runs.
#
# Two things about this build are not obvious and both have bitten:
#
#   1. `next build` with output: "standalone" does NOT copy .next/static into
#      the standalone directory. Miss the copy below and the app serves HTML
#      with no CSS and no JavaScript — every page renders, nothing works, and
#      there is no error anywhere.
#   2. app/layout.tsx uses next/font/google, which downloads Archivo and Inter
#      at BUILD time and self-hosts them into the bundle. That means the build
#      needs egress to fonts.googleapis.com, and it means the running container
#      does not. A build on an airgapped runner fails here.
FROM node:22-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 is native. The prebuilt binary usually lands, but when it does
# not, node-gyp needs these — and a build that silently falls back to compiling
# without them fails in a way that reads like a network error.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
# Playwright is a devDependency and its browser is not wanted in an image.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .
# Baked in at build time by Next, so it has to be present here and not only at
# run time: it is what serverActions.allowedOrigins is built from, and without
# it every form submit 403s behind the proxy while every page still renders.
ARG APP_HOSTNAME
ENV APP_HOSTNAME=${APP_HOSTNAME}
RUN npm run build

# The backup's own dependency tree.
#
# scripts/backup.mjs imports @aws-sdk/client-s3, and Next never sees that file
# — it is not part of the app — so the tracer leaves the package out of the
# standalone output and the script dies with "Cannot find module". That is the
# same shape as the bug it replaced, where it shelled out to an `aws` binary
# the image did not install, so it is not left to chance.
#
# Installed into its own prefix rather than glob-copied out of /app: npm
# computes the transitive closure correctly and the first hand-written glob
# missed @aws/lambda-invoke-store, which is exactly the kind of thing a glob
# misses. The version comes from our own package.json, so there is nothing to
# keep in step.
RUN mkdir -p /backup-deps && cd /backup-deps && npm init -y > /dev/null \
  && npm install --omit=dev --no-audit --no-fund \
       "@aws-sdk/client-s3@$(node -p "require('/app/package.json').dependencies['@aws-sdk/client-s3']")"

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# Set explicitly, because the default is relative to process.cwd() and the
# standalone server's cwd is /app — which would put the database and every
# uploaded report inside the image, to be destroyed by the next redeploy.
ENV DB_PATH=/app/data/strategy.sqlite
ENV PORT=3000
# Docker sets HOSTNAME to the container id; standalone must also bind loopback
# for the healthcheck, and all interfaces for the proxy.
ENV HOSTNAME=0.0.0.0

# `tar` for the backup archive, `curl` for the healthcheck. Everything else the
# app needs is inside server.js.
RUN apt-get update && apt-get install -y --no-install-recommends tar curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/.next/standalone ./
# The copy that standalone leaves out. Without it: no CSS, no JS, no error.
COPY --from=build /app/.next/static ./.next/static
# The backup runs against the same database from the same image. It needs no
# node_modules of its own: Next's standalone output already carries
# better-sqlite3 (with its linux-x64 prebuild) at ./node_modules, which is
# where /app/scripts/backup.mjs resolves it from.
COPY --from=build /app/scripts ./scripts
# Resolved by Node from /app/scripts/backup.mjs. About 22 MB, and the only
# thing in the image that the app itself does not use.
COPY --from=build /backup-deps/node_modules ./scripts/node_modules

# Non-root, and owning the data directory so the volume is writable.
RUN useradd --uid 10001 --create-home app \
  && mkdir -p /app/data/docs \
  && chown -R app:app /app/data
USER app

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/login >/dev/null || exit 1

CMD ["node", "server.js"]
