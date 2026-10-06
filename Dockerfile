# Build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev=false
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage — non-root, minimal (TRD §16.10 supply-chain hardening)
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -g 10001 appuser && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin appuser
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER 10001:10001
EXPOSE 3000
# readOnlyRootFilesystem + dropped caps are enforced in docker-compose/K8s (§16.11/§16.12).
CMD ["node", "dist/main/server.js"]
