# One image for the API, the worker and database migrations. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t chekmark-api .
# Start it as:
#   API:        node dist/main.js     (the default)
#   Worker:     node dist/worker.js
#   Migrations: npx prisma migrate deploy   (a release step, run before the new version starts)

FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /repo

# Build stage: all dependencies, then compile, then keep only what production needs.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter api... --ignore-scripts
COPY apps/api apps/api
RUN pnpm --filter api exec prisma generate && pnpm --filter api build
# A standalone copy of the api package with production dependencies only.
RUN pnpm --filter api deploy --prod --legacy /out && cp -r apps/api/dist /out/dist

# Runtime stage: no compilers, no dev dependencies, not root.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Only what runs: compiled code, production packages, and the schema and migrations for the release step.
COPY --from=build --chown=node:node /out/package.json /out/prisma.config.ts ./
COPY --from=build --chown=node:node /out/prisma ./prisma
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
