FROM node:24-alpine AS builder
# git for commit-hash capture.
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json ./
COPY packages/client/package*.json packages/client/
COPY packages/server/package*.json packages/server/
COPY packages/ui/package*.json packages/ui/
COPY packages/sdk/package*.json packages/sdk/
RUN npm install
COPY . .
RUN git rev-parse --short HEAD > /tmp/COMMIT_SHA || echo "unknown" > /tmp/COMMIT_SHA
# Shared workspace packages must be built before the client typecheck since
# the client imports from `@azrtydxb/ui` which resolves via dist/.
RUN npm run build:shared
RUN npm run build
# tsc with moduleResolution:"bundler" emits extensionless relative imports,
# but Node ESM requires .js extensions. Patch all compiled .js files.
RUN node scripts/fix-esm-imports.mjs

FROM node:24-slim
# Debian (glibc) runtime: onnxruntime-node (semantic search) ships a glibc-linked native
# binary that can't load on Alpine/musl (no ld-linux-aarch64.so.1). libgomp1 = its OpenMP
# runtime dependency.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package*.json ./
# Drizzle migrations the entrypoint applies against POSTGRES_URL at boot.
COPY --from=builder /app/packages/server/src/db/migrations ./dist/db/migrations
COPY --from=builder /app/packages/server/scripts/migrate-prod.mjs ./scripts/migrate-prod.mjs
COPY --from=builder /app/packages/client/dist ./public
RUN npm install --omit=dev
RUN groupadd -r app && useradd -r -g app -d /app app
RUN mkdir -p /notes && chown -R app:app /app /notes
COPY --from=builder /app/package.json /package.json
COPY --from=builder /tmp/COMMIT_SHA /COMMIT_SHA
COPY --chown=app:app entrypoint.sh ./entrypoint.sh
USER app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
