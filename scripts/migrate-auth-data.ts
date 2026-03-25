/**
 * migrate-auth-data.ts
 *
 * One-time migration script: copies data from the old TypeORM-managed tables
 * (user, auth_provider, invite_code) into better-auth's schema (user, account,
 * invite_code with new column names).
 *
 * Run with:
 *   npx tsx scripts/migrate-auth-data.ts
 *
 * The script is idempotent — it uses ON CONFLICT DO NOTHING everywhere and
 * checks for table existence before reading, so it is safe to run on a fresh
 * install or to re-run if it was interrupted.
 *
 * Environment variables (same as the server):
 *   DATABASE_URL   — postgres connection string (required)
 */

import { randomUUID } from "crypto";
import pg from "pg";

const { Client } = pg;

// ---------------------------------------------------------------------------
// Types for old schema rows
// ---------------------------------------------------------------------------

interface OldUser {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: string;
  avatar_url: string | null;
  disabled: boolean;
  created_at: Date;
  updated_at: Date;
}

interface OldAuthProvider {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
  created_at: Date;
}

interface OldInviteCode {
  id: string;
  code: string;
  created_by: string;
  used_by: string | null;
  expires_at: Date | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tableExists(client: pg.Client, tableName: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [tableName]
  );
  return res.rows[0]?.exists ?? false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL environment variable is not set.");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  console.log("Connected to PostgreSQL.");

  const stats = {
    usersChecked: 0,
    usersMigrated: 0,
    accountsCreated: 0,
    inviteCodesMigrated: 0,
    errors: [] as string[],
  };

  try {
    // -----------------------------------------------------------------------
    // 1. Check whether old tables exist
    // -----------------------------------------------------------------------
    const hasOldUser = await tableExists(client, "user");
    const hasOldAuthProvider = await tableExists(client, "auth_provider");
    const hasOldInviteCode = await tableExists(client, "invite_code");

    if (!hasOldUser) {
      console.log('Old "user" table not found — nothing to migrate (fresh install).');
      return;
    }

    // -----------------------------------------------------------------------
    // 2. Migrate users
    // -----------------------------------------------------------------------
    console.log("\nMigrating users...");

    const usersResult = await client.query<OldUser>(
      `SELECT id, email, name, "passwordHash" as password_hash, role, "avatarUrl" as avatar_url, disabled,
              "createdAt" as created_at, "updatedAt" as updated_at
       FROM "user"
       ORDER BY "createdAt" ASC`
    );

    stats.usersChecked = usersResult.rowCount ?? 0;
    console.log(`  Found ${stats.usersChecked} user(s) in old table.`);

    for (const u of usersResult.rows) {
      try {
        // Insert into better-auth's "user" table
        const insertUserResult = await client.query(
          `INSERT INTO "user"
             (id, name, email, "emailVerified", image, role, disabled,
              "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            u.id,
            u.name,
            u.email,
            true,              // emailVerified — existing users are verified
            u.avatar_url,      // image
            u.role,
            u.disabled,
            u.created_at,
            u.updated_at,
          ]
        );

        if ((insertUserResult.rowCount ?? 0) > 0) {
          stats.usersMigrated++;
          console.log(`  + user ${u.email}`);
        } else {
          console.log(`  ~ user ${u.email} (already exists, skipped)`);
        }

        // -----------------------------------------------------------------------
        // 3. Create credential account for password-based users
        // -----------------------------------------------------------------------
        if (u.password_hash) {
          const insertAccountResult = await client.query(
            `INSERT INTO account
               (id, "userId", "accountId", "providerId", password,
                "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT ("providerId", "accountId") DO NOTHING`,
            [
              randomUUID(),
              u.id,
              u.email,          // accountId = email for credential provider
              "credential",
              u.password_hash,  // bcrypt hash — compatible with better-auth
              u.created_at,
              u.updated_at,
            ]
          );

          if ((insertAccountResult.rowCount ?? 0) > 0) {
            stats.accountsCreated++;
            console.log(`    + credential account for ${u.email}`);
          } else {
            console.log(`    ~ credential account for ${u.email} (already exists, skipped)`);
          }
        }
      } catch (err) {
        const msg = `Failed to migrate user ${u.email}: ${String(err)}`;
        stats.errors.push(msg);
        console.error(`  ERROR: ${msg}`);
      }
    }

    // -----------------------------------------------------------------------
    // 4. Migrate OAuth accounts from auth_provider
    // -----------------------------------------------------------------------
    if (hasOldAuthProvider) {
      console.log("\nMigrating OAuth providers...");

      const providersResult = await client.query<OldAuthProvider>(
        `SELECT id, "userId" as user_id, provider, "providerAccountId" as provider_account_id, "createdAt" as created_at
         FROM auth_provider`
      );

      console.log(`  Found ${providersResult.rowCount ?? 0} auth_provider row(s).`);

      for (const p of providersResult.rows) {
        try {
          const insertResult = await client.query(
            `INSERT INTO account
               (id, "userId", "accountId", "providerId",
                "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT ("providerId", "accountId") DO NOTHING`,
            [
              randomUUID(),
              p.user_id,
              p.provider_account_id,  // accountId = provider's user ID
              p.provider,             // providerId = "google" / "github"
              p.created_at,
              p.created_at,
            ]
          );

          if ((insertResult.rowCount ?? 0) > 0) {
            stats.accountsCreated++;
            console.log(`  + ${p.provider} account for userId=${p.user_id}`);
          } else {
            console.log(`  ~ ${p.provider} account for userId=${p.user_id} (already exists, skipped)`);
          }
        } catch (err) {
          const msg = `Failed to migrate auth_provider ${p.id}: ${String(err)}`;
          stats.errors.push(msg);
          console.error(`  ERROR: ${msg}`);
        }
      }
    } else {
      console.log('\nOld "auth_provider" table not found — skipping OAuth migration.');
    }

    // -----------------------------------------------------------------------
    // 5. Migrate invite codes
    //
    // Old schema:  created_by (userId), used_by (userId), expires_at, created_at
    // New schema:  createdById, usedById, expiresAt, createdAt
    // -----------------------------------------------------------------------
    if (hasOldInviteCode) {
      console.log("\nMigrating invite codes...");

      const invitesResult = await client.query<OldInviteCode>(
        `SELECT id, code, "createdByUserId" as created_by, "usedBy" as used_by, "expiresAt" as expires_at, "createdAt" as created_at
         FROM invite_code`
      );

      console.log(`  Found ${invitesResult.rowCount ?? 0} invite_code row(s).`);

      for (const inv of invitesResult.rows) {
        try {
          const insertResult = await client.query(
            `INSERT INTO "InviteCode"
               (id, code, "createdById", "usedById", "expiresAt", "createdAt")
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [
              inv.id,
              inv.code,
              inv.created_by,
              inv.used_by,
              inv.expires_at,
              inv.created_at,
            ]
          );

          if ((insertResult.rowCount ?? 0) > 0) {
            stats.inviteCodesMigrated++;
            console.log(`  + invite code ${inv.code}`);
          } else {
            console.log(`  ~ invite code ${inv.code} (already exists, skipped)`);
          }
        } catch (err) {
          const msg = `Failed to migrate invite code ${inv.id}: ${String(err)}`;
          stats.errors.push(msg);
          console.error(`  ERROR: ${msg}`);
        }
      }
    } else {
      console.log('\nOld "invite_code" table not found — skipping invite code migration.');
    }
  } finally {
    await client.end();
    console.log("\nDisconnected from PostgreSQL.");
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n========== Migration Summary ==========");
  console.log(`  Users found in old table : ${stats.usersChecked}`);
  console.log(`  Users migrated           : ${stats.usersMigrated}`);
  console.log(`  Accounts created         : ${stats.accountsCreated}`);
  console.log(`  Invite codes migrated    : ${stats.inviteCodesMigrated}`);
  console.log(`  Errors                   : ${stats.errors.length}`);
  if (stats.errors.length > 0) {
    console.log("\nError details:");
    for (const e of stats.errors) {
      console.log(`  - ${e}`);
    }
    process.exit(1);
  } else {
    console.log("\nMigration completed successfully.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
