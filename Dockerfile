FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/client/package*.json packages/client/
COPY packages/server/package*.json packages/server/
RUN npm install
COPY . .
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package*.json ./
COPY --from=builder /app/packages/server/prisma ./prisma
COPY --from=builder /app/packages/client/dist ./public
RUN npm install --omit=dev
RUN npx prisma generate --schema=prisma/schema.prisma
RUN addgroup -S app && adduser -S app -G app
RUN mkdir -p /notes && chown -R app:app /app /notes
USER app
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/index.js"]
