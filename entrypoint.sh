#!/bin/sh
set -e

# Run database schema sync before starting
if [ -n "$DATABASE_URL" ]; then
  echo "Running database schema sync..."
  npx prisma db push --accept-data-loss 2>&1 || \
    echo "Warning: prisma db push failed, continuing anyway"
fi

exec node dist/index.js
