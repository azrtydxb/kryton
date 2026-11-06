# Cross-build: every stage that runs commands is pinned to $BUILDPLATFORM, so an
# arm64 image is assembled on the native (amd64) builder with no emulation. The
# final stage only COPYs. The JS build output is arch-independent; the native
# bits (onnxruntime-node, sharp, libgomp) are fetched for $TARGETARCH below.
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder
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

# Runtime tree for the target arch, assembled on the build platform (Debian/glibc,
# same base as the final image): onnxruntime-node (semantic search) ships a
# glibc-linked native binary that can't load on Alpine/musl; libgomp1 is its
# OpenMP runtime dependency.
FROM --platform=$BUILDPLATFORM node:24-slim AS assemble
ARG TARGETARCH
RUN case "$TARGETARCH" in amd64) echo x64 > /npm-arch ;; arm64) echo arm64 > /npm-arch ;; *) echo "unsupported TARGETARCH=$TARGETARCH" >&2; exit 1 ;; esac
# libgomp1 for the target arch: fetch the .deb and unpack it (no target-arch exec).
RUN set -eux; \
  dpkg --add-architecture "$TARGETARCH"; \
  apt-get update; \
  mkdir /gomp-deb && cd /gomp-deb; \
  apt-get download "libgomp1:$TARGETARCH"; \
  mkdir /gomp && dpkg-deb -x ./libgomp1_*.deb /gomp; \
  rm -rf /var/lib/apt/lists/*
RUN groupadd -r -g 999 app && useradd -r -u 999 -g app -d /app app
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package*.json ./
# Drizzle migrations the entrypoint applies against POSTGRES_URL at boot.
COPY --from=builder /app/packages/server/src/db/migrations ./dist/db/migrations
COPY --from=builder /app/packages/server/scripts/migrate-prod.mjs ./scripts/migrate-prod.mjs
COPY --from=builder /app/packages/client/dist ./public
# npm_config_arch/platform make prebuilt native addons (sharp, onnxruntime) resolve for the target.
RUN npm_config_arch="$(cat /npm-arch)" npm_config_platform=linux npm install --omit=dev
COPY entrypoint.sh ./entrypoint.sh
RUN mkdir -p /notes && chown -R app:app /app /notes

FROM node:24-slim
COPY --from=assemble /gomp/usr/lib/ /usr/lib/
COPY --from=assemble /etc/passwd /etc/group /etc/
COPY --from=assemble /app /app
COPY --from=assemble /notes /notes
COPY --from=builder /app/package.json /package.json
COPY --from=builder /tmp/COMMIT_SHA /COMMIT_SHA
WORKDIR /app
USER app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
