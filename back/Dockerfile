# SOWEN API. Build from the repository root:  docker build -f back/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY back/package.json back/
COPY front/package.json front/
RUN npm ci --workspace back --include-workspace-root
COPY back back
RUN npm --workspace back run prisma:generate && npm --workspace back run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/back back
# Uploaded documents live here (a volume in production). Owned by the unprivileged user the API runs as.
RUN mkdir -p /app/back/uploads && chown node:node /app/back/uploads && chmod 700 /app/back/uploads
USER node
WORKDIR /app/back
EXPOSE 4000
# Migrations are applied explicitly before a new version is started (docs/DEPLOYMENT.md), never by this command.
CMD ["node", "dist/src/main.js"]
