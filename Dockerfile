# Container image for the matt-grant-chrome microservice.
# Multi-stage: build the TypeScript with the full workspace, then ship a slim
# production image with only runtime deps + the compiled service.

# --- build ---
FROM node:20-slim AS build
WORKDIR /app
# Install against the lockfile (workspace package manifests first for caching).
COPY package.json package-lock.json ./
COPY service/package.json service/package.json
COPY extension/package.json extension/package.json
RUN npm ci
COPY . .
RUN npm run build:service
# Build the extension and pack the downloadable zip into service/public/download
# so the landing page's "Download for Chrome" button is served, not a 404. The
# extension bakes its public VITE_* prod defaults from clerkConfig.ts/api.ts.
RUN npm run build:download

# --- runtime ---
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY service/package.json service/package.json
COPY extension/package.json extension/package.json
# Production dependencies only (no vitest/tsc/etc.).
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/service/dist ./service/dist
# The landing page + packaged download zip (index.ts serves service/public).
COPY --from=build /app/service/public ./service/public
EXPOSE 8787
USER node
# index.js runs assertSecureStartup() and refuses to boot on insecure prod config.
CMD ["node", "service/dist/index.js"]
