#!/bin/sh
set -e

# Run smart migration with backup and legacy detection
node scripts/migrate.mjs

exec node dist/index.js
