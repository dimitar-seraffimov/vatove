FROM node:24-bookworm-slim AS web-build
WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
COPY apps/web/package.json apps/web/tsconfig*.json apps/web/vite.config.* ./apps/web/
COPY apps/web/index.html ./apps/web/index.html
COPY apps/web/public ./apps/web/public
COPY apps/web/src ./apps/web/src
COPY services/api/package.json ./services/api/package.json

RUN npm ci --include=dev
ARG VITE_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL
RUN npm run build --workspace @vatove/contracts && npm run build --workspace @vatove/web

FROM nginx:1.29-alpine
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
