FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/client/package*.json packages/client/
COPY packages/server/package*.json packages/server/
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/packages/server/dist ./dist
COPY --from=builder /app/packages/server/package*.json ./
COPY --from=builder /app/packages/client/dist ./public
RUN npm install --production
EXPOSE 3000
CMD ["node", "dist/index.js"]
