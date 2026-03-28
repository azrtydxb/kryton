FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/client/package*.json packages/client/
COPY packages/server/package*.json packages/server/
RUN npm install
COPY . .
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma
RUN npm run build
# tsc with moduleResolution:"bundler" emits extensionless relative imports,
# but Node ESM requires .js extensions. Patch all compiled .js files.
RUN node scripts/fix-esm-imports.mjs

FROM node:24-alpine
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
COPY --chown=app:app entrypoint.sh ./entrypoint.sh
USER app
ENV PORT=3000
ENV DATABASE_URL=file:/data/mnemo.db
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
