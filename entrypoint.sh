#!/bin/sh
set -e

# Fix notes directory permissions (in case of bind-mount owned by different user)
chown -R app:app /notes 2>/dev/null || true

# Run database schema sync before starting
# Uses prisma.config.mjs which provides connection via DATABASE_URL env var
if [ -n "$DATABASE_URL" ]; then
  echo "Running database schema sync..."
  node --input-type=module << 'JSEOF'
import { execSync } from 'child_process';
try {
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
} catch (e) {
  console.error('Warning: prisma db push failed, continuing anyway:', e.message);
}
JSEOF
fi

exec node dist/index.js
