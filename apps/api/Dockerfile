FROM node:22-alpine

WORKDIR /app

# Workspace manifests first, so a dependency-free code change reuses this layer.
COPY package.json package-lock.json* ./
COPY apps/api/package.json ./apps/api/
RUN npm ci --omit=dev --workspace apps/api || npm install --omit=dev --workspace apps/api

COPY apps/api ./apps/api

ENV NODE_ENV=production
EXPOSE 4100
CMD ["node", "apps/api/src/index.js"]
