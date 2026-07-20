FROM docker.io/library/node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
COPY services/api/package.json services/api/tsconfig.json ./services/api/
COPY services/api/src ./services/api/src
COPY apps/web/package.json ./apps/web/package.json

RUN npm ci --include=dev \
    && npm run build --workspace @vatove/contracts \
    && npm run build --workspace @vatove/api \
    && npm prune --omit=dev

FROM docker.io/library/node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/services/api/package.json ./services/api/package.json
COPY --from=build /app/services/api/dist ./services/api/dist

USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "services/api/dist/server.js"]
