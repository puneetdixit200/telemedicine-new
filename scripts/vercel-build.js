'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function run(command, args, label, envOverrides = {}) {
  console.log(`[build] ${label}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
    shell: false
  });

  if (result.error) {
    console.error(`[build] ${label} could not start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[build] ${label} failed with exit code ${result.status}.`);
    process.exit(result.status || 1);
  }
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const isVercelProduction = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';

run(npx, ['--no-install', 'prisma', 'generate'], 'Generating Prisma Client');

if (isVercelProduction) {
  const migrationDatabaseUrl = String(process.env.MIGRATION_DATABASE_URL || '').trim();

  if (migrationDatabaseUrl) {
    run(
      npx,
      ['--no-install', 'prisma', 'migrate', 'deploy'],
      'Applying pending production database migrations',
      {
        DATABASE_URL: migrationDatabaseUrl,
        DIRECT_URL: migrationDatabaseUrl
      }
    );
  } else {
    console.log(
      '[build] MIGRATION_DATABASE_URL is not configured; skipping migration application and enforcing schema compatibility instead.'
    );
  }

  run(
    process.execPath,
    [path.join(__dirname, 'verify-production-schema.js')],
    'Verifying production database schema required by the deployed code',
    {
      DIRECT_URL: process.env.DATABASE_URL || process.env.DIRECT_URL || ''
    }
  );
} else {
  console.log('[build] Skipping production database checks outside Vercel production.');
}

run(npx, ['--no-install', 'next', 'build'], 'Building Next.js application');
