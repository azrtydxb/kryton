FROM node:24-alpine AS builder
# python3 + build tools needed for better-sqlite3 native build when no
# prebuilt binary is available; git for commit hash capture.
RUN apk add --no-cache git python3 make g++
WORKDIR /app
COPY package*.json ./
COPY packages/client/package*.json packages/client/
COPY packages/server/package*.json packages/server/
COPY packages/core/package*.json packages/core/
COPY packages/core-react/package*.json packages/core-react/
COPY packages/ui/package*.json packages/ui/
RUN npm install
COPY . .
RUN git rev-parse --short HEAD > /tmp/COMMIT_SHA || echo "unknown" > /tmp/COMMIT_SHA
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma
RUN npm run build
# tsc with moduleResolution:"bundler" emits extensionless relative imports,
# but Node ESM requires .js extensions. Patch all compiled .js files.
RUN node scripts/fix-esm-imports.mjs

FROM node:24-alpine
# python3 + build tools needed for native module compilation
# (better-sqlite3) when prebuilt binaries aren't available.
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package*.json ./
COPY --from=builder /app/packages/server/prisma ./prisma
COPY --from=builder /app/packages/client/dist ./public
RUN npm install --omit=dev
RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /notes /data && chown -R app:app /app /notes /data
COPY --chown=app:app packages/server/prisma.config.mjs ./prisma.config.mjs
COPY --chown=app:app packages/server/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder /app/package.json /package.json
COPY --from=builder /tmp/COMMIT_SHA /COMMIT_SHA
COPY --chown=app:app entrypoint.sh ./entrypoint.sh
USER app
ENV PORT=3000
ENV DATABASE_URL=file:/data/kryton.db
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
