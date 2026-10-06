# YaoYao AI — API image (multi-stage, pinned base).
FROM node:24.20.0-alpine AS builder
WORKDIR /app
# Copy workspace manifests first for layer caching.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY core/domain/package.json core/domain/
COPY core/application/package.json core/application/
COPY core/infrastructure/package.json core/infrastructure/
COPY core/api/package.json core/api/
RUN npm ci
# Copy sources and build all workspace packages.
COPY tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY core ./core
COPY db ./db
COPY scripts ./scripts
COPY tests ./tests
COPY drizzle.config.ts ./
RUN npm run build

FROM node:24.20.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Non-root user (Technical Proposal §14).
RUN addgroup -S yaoyao && adduser -S yaoyao -G yaoyao
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/core ./core
RUN chown -R yaoyao:yaoyao /app
USER yaoyao
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
