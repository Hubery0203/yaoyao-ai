# YaoYao AI — worker image (multi-stage, pinned base).
FROM node:24.20.0-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY core/domain/package.json core/domain/
COPY core/application/package.json core/application/
COPY core/infrastructure/package.json core/infrastructure/
COPY core/api/package.json core/api/
RUN npm ci
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
RUN addgroup -S yaoyao && adduser -S yaoyao -G yaoyao
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/core ./core
RUN chown -R yaoyao:yaoyao /app
USER yaoyao
CMD ["node", "apps/worker/dist/main.js"]
