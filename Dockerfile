# ---- Build stage: compile TypeScript ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
# Prefer reproducible installs (npm ci) when a lockfile exists; fall back to npm install
# so the very first build works before package-lock.json is committed. COMMIT THE LOCKFILE.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Deps stage: production-only node_modules (keeps node-pg-migrate for the Job) ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- Runtime stage ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tini for correct PID 1 signal handling (clean SIGTERM on pod termination)
RUN apk add --no-cache tini

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist        ./dist
COPY package*.json ./
COPY migrations ./migrations
COPY public     ./public

# Run as the built-in non-root user (K8s runAsNonRoot).
USER node
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
# Default command runs the API. Other entrypoints reuse this SAME image, overriding CMD:
#   • migrations (Job / compose "migrate"):  npx node-pg-migrate up
#   • nightly content generator (CronJob):   node dist/jobs/generateDailyContent.js
CMD ["node", "dist/server.js"]
