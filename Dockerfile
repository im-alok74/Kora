# One image for the web app and the background worker. Choose with the command:
#   web:     pnpm --filter @kora/web exec next start -p 3000
#   worker:  pnpm --filter @kora/worker start
# The image holds Chromium (for PDFs), so it is large. Secrets come from the environment, never from the image.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
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

FROM build AS run
ENV NODE_ENV=production PORT=3000
USER root
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||process.env.PORT)+(process.env.WORKER_HEALTH_PORT?'/healthz':'/api/health')).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@kora/web", "exec", "next", "start", "-p", "3000"]
