#!/bin/sh
set -e

# Apply pending Drizzle migrations against POSTGRES_URL, then boot the server.
node scripts/migrate-prod.mjs

exec node dist/server.js
