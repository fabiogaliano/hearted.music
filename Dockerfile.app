# syntax=docker/dockerfile:1
# Web app image. Built in CI and pushed to GHCR; Coolify only pulls it.

FROM oven/bun:1.3.14 AS base
WORKDIR /app

FROM base AS build-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM build-deps AS build
# VITE_* values are inlined into the bundles at build time, so they are build
# args here, not runtime env in Coolify.
ARG VITE_PUBLIC_APP_ORIGIN
ARG VITE_APP_TITLE
ARG VITE_CHROME_EXTENSION_ID
ARG VITE_USERJOT_PROJECT_ID
ARG VITE_ACCOUNT_EVENTS_GATEWAY_URL
ARG VITE_PUBLIC_POSTHOG_PROJECT_TOKEN
ARG VITE_PUBLIC_POSTHOG_HOST
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENVIRONMENT
ARG VITE_SENTRY_ORG_SLUG
ARG VITE_APP_RELEASE
COPY . .
# The token uploads sourcemaps; a secret mount keeps it out of the image layers.
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
    RELEASE=true bun run build

FROM base
ENV NODE_ENV=production
ENV PORT=3000
# Names this process in its JSON log lines (src/lib/observability/logger.ts).
ENV HEARTED_SERVICE=web-server

# Coolify's healthcheck runs curl inside the container. Without curl every
# deploy rolled back as unhealthy; with the check off, Coolify stopped the old
# container before the new one was routable and each deploy answered 503s.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY --from=build /app/dist ./dist
COPY src/serve.ts src/instrument.ts ./src/
COPY src/lib/observability/sentry-before-send.ts ./src/lib/observability/

# src/instrument.ts tags Sentry events with the release the sourcemaps were
# uploaded under. Declared last: the value changes every commit and is in the
# environment of every later RUN, so declared first it rebuilt the curl layer
# on every deploy. Above it, the curl and node_modules layers stay cached until
# the base image or bun.lock changes, and the VPS pulls only the changed layers.
ARG VITE_APP_RELEASE
ENV APP_RELEASE=$VITE_APP_RELEASE

USER bun

EXPOSE 3000

# Traefik routes only to healthy containers; probing every second during the
# start period makes a new container routable right after it starts listening
# instead of after the first 30 s interval.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --start-interval=1s --retries=3 \
  CMD curl -sf "http://127.0.0.1:${PORT:-3000}/health" > /dev/null || exit 1

# No `run` subcommand: `bun --preload X run Y` drops Y; run the file directly.
CMD ["bun", "--preload", "./src/instrument.ts", "src/serve.ts"]
