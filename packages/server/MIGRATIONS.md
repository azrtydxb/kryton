# Database Migrations

Mnemo uses [Prisma Migrate](https://www.prisma.io/docs/concepts/components/prisma-migrate) for database schema versioning.

## For developers

When you change `prisma/schema.prisma`, create a new migration:

```bash
DATABASE_URL="file:./data/mnemo.db" npx prisma migrate dev --name describe_your_change
```

This generates a new migration file in `prisma/migrations/`. Commit it alongside your schema change.

## For production

Migrations run automatically on container startup via `scripts/migrate.mjs`. The script:

1. Backs up the database (keeps the 5 most recent backups)
2. Detects legacy databases and baselines them
3. Runs `prisma migrate deploy` to apply any pending migrations

## Upgrading from pre-v3.3.0 (db push era)

Databases created before v3.3.0 used `prisma db push` and have no migration history. The migration script detects this automatically (no `_prisma_migrations` table present) and baselines the `init` migration before applying any subsequent ones. No manual action is required.
