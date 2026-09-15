# Debian slim rather than alpine: bcrypt ships prebuilt binaries for glibc, and
# on musl it has to compile from source, which means dragging python3/make/g++
# into the image for no benefit.

# ---- build the client -------------------------------------------------------
FROM node:24-bookworm-slim AS client

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY apps/web ./apps/web
RUN npm run build --workspace apps/web

# ---- runtime ----------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
RUN npm ci --omit=dev --workspace apps/api && npm cache clean --force

COPY apps/api ./apps/api

# The API serves this in production. Without it the site deploys as a bare API
# and serveClient() skips silently, which is a very quiet way to ship nothing.
COPY --from=client /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 4100
CMD ["node", "apps/api/src/index.js"]
