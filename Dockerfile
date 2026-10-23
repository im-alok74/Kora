# One repository, two services. Build the one you want with --target (the default, with no --target, is the web app):
#   web:     docker build --target web -t kora-web .         runs  next start -p 3000
#   worker:  docker build --target worker -t kora-worker .   runs  pnpm --filter @kora/worker start
# The image holds Chromium (for PDFs), so it is large. Secrets come from the environment, never from the image.
# Both run as a normal user (kora), not root. For the worker set WORKER_HEALTH_PORT (for example 8081) and point the host's
# health check at /healthz; the built-in HEALTHCHECK uses it automatically.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/opt/corepack PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@10.0.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Only the build needs a database URL to exist; it is not contacted while building.
RUN DATABASE_URL=postgres://build:build@localhost/build OTP_HMAC_SECRET=build-only-build-only-build-only-1 GATEWAY_WEBHOOK_SECRET=build-only-build-only-build-only-1 GSP_URL=http://localhost pnpm --filter @kora/web build
RUN pnpm --filter @kora/pdf exec playwright install --with-deps chromium

# Shared runtime: the built app, owned by an unprivileged user.
FROM build AS runtime
ENV NODE_ENV=production PORT=3000
RUN useradd --create-home --uid 10001 kora && chown -R kora:kora /app /ms-playwright /opt/corepack /pnpm
USER kora
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||process.env.PORT)+(process.env.WORKER_HEALTH_PORT?'/healthz':'/api/health')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

FROM runtime AS worker
CMD ["pnpm", "--filter", "@kora/worker", "start"]

# Last stage, so a build with no --target gives the web app.
FROM runtime AS web
EXPOSE 3000
CMD ["pnpm", "--filter", "@kora/web", "exec", "next", "start", "-p", "3000"]
