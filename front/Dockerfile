# SOWEN web application. Build from the repository root:  docker build -f front/Dockerfile .
# The address of the API is compiled into the pages: it must be given at build time.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL is required (for example https://app.example.com/api)" && exit 1)
COPY package.json package-lock.json ./
COPY back/package.json back/
COPY front/package.json front/
RUN npm ci --workspace front --include-workspace-root
COPY front front
RUN npm --workspace front run build

FROM node:24-bookworm-slim
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
# The same values at run time: the security headers (CSP, HSTS) are computed from them.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules node_modules
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/front front
USER node
WORKDIR /app/front
EXPOSE 3000
CMD ["node", "../node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
