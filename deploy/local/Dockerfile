# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 STRATEGY_LOCAL_ONLY=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 STRATEGY_LOCAL_ONLY=1 HOSTNAME=0.0.0.0 PORT=3000 DB_PATH=/app/data/strategy.sqlite
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY deploy/local/start.mjs ./local-start.mjs
COPY deploy/local/snapshot.mjs ./snapshot.mjs
COPY deploy/local/jobs.mjs deploy/local/worker.mjs ./
COPY --chmod=444 deploy/local/web-gateway.mjs ./web-gateway.mjs
RUN useradd --uid 10001 --create-home app && mkdir -p /app/data/docs /app/.next/cache && chown -R app:app /app/data /app/.next/cache
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "local-start.mjs"]
