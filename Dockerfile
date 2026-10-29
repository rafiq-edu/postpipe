FROM node:24.21.0-alpine AS base
RUN npm i -g pnpm@11.17.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM deps AS prod-deps
RUN pnpm prune --prod

FROM node:24.21.0-alpine AS web
ARG GIT_SHA=dev
ENV NODE_ENV=production GIT_SHA=$GIT_SHA HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:24.21.0-alpine AS worker
ARG GIT_SHA=dev
ENV NODE_ENV=production GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/worker.ts /app/package.json /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts/register-ts.mjs ./scripts/register-ts.mjs
USER node
CMD ["node", "--import", "./scripts/register-ts.mjs", "worker.ts"]
