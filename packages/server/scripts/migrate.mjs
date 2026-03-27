#!/usr/bin/env node
/**
 * Smart migration script for production deployments.
 * - Backs up the database before migration (keeps 5 most recent)
 * - Detects legacy databases (from prisma db push era) and baselines them
 * - Runs prisma migrate deploy for safe schema updates
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DB_URL = process.env.DATABASE_URL || 'file:./data/mnemo.db';
const DB_PATH = DB_URL.replace('file:', '');
const resolvedPath = path.resolve(DB_PATH);

// 1. Back up database if it exists
if (fs.existsSync(resolvedPath)) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${resolvedPath}.backup.${timestamp}`;
  console.log(`Backing up database to ${backupPath}`);
  fs.copyFileSync(resolvedPath, backupPath);

  // Keep only 5 most recent backups
  const dir = path.dirname(resolvedPath);
  const baseName = path.basename(resolvedPath);
  const backups = fs.readdirSync(dir)
    .filter(f => f.startsWith(`${baseName}.backup.`))
    .sort()
    .reverse();
  for (const old of backups.slice(5)) {
    fs.unlinkSync(path.join(dir, old));
    console.log(`Removed old backup: ${old}`);
  }
}

// 2. Attempt migrate deploy — detect and handle legacy databases
if (fs.existsSync(resolvedPath)) {
  let deployOutput = '';
  let deployFailed = false;

  try {
    deployOutput = execSync('npx prisma migrate deploy 2>&1', {
      encoding: 'utf-8',
      env: { ...process.env, DATABASE_URL: DB_URL },
    });
    console.log(deployOutput);
    console.log('Migrations applied successfully.');
    process.exit(0);
  } catch (err) {
    deployOutput = err.stdout || err.stderr || String(err);
    deployFailed = true;
  }

  const isLegacyDb =
    deployOutput.includes('P3005') ||
    deployOutput.includes('database schema is not empty') ||
    deployOutput.includes('baseline');

  if (deployFailed && isLegacyDb) {
    // Legacy database (created with prisma db push) — baseline the init migration
    console.log('Legacy database detected — baselining migration history...');

    const migrationsDir = path.resolve('prisma/migrations');
    const migrations = fs.readdirSync(migrationsDir)
      .filter(f => fs.statSync(path.join(migrationsDir, f)).isDirectory())
      .sort();

    if (migrations.length > 0) {
      try {
        execSync(`npx prisma migrate resolve --applied "${migrations[0]}"`, {
          stdio: 'inherit',
          env: { ...process.env, DATABASE_URL: DB_URL },
        });
        console.log('Baseline applied. Running remaining migrations...');
        execSync('npx prisma migrate deploy', {
          stdio: 'inherit',
          env: { ...process.env, DATABASE_URL: DB_URL },
        });
        console.log('Migrations applied successfully.');
      } catch (baselineErr) {
        console.error('Baseline failed:', baselineErr.message);
        console.log('Continuing with startup...');
      }
    } else {
      console.error('No migrations found for baselining.');
      console.log('Continuing with startup...');
    }
  } else if (deployFailed) {
    console.error('Migration error:', deployOutput);
    console.log('Continuing with startup...');
  }
} else {
  // Fresh install — run migrate deploy to create the database from migrations
  console.log('Fresh install — creating database from migrations...');
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: DB_URL },
    });
    console.log('Database created and migrations applied successfully.');
  } catch (err) {
    console.error('Initial migration failed:', err.message);
    console.log('Continuing with startup...');
  }
}
