'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const requiredColumns = new Set([
    'workflowStartedAt',
    'workflowStartedById',
    'approvalAvailableAt'
  ]);

  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AgentRun'
      AND column_name IN (
        'workflowStartedAt',
        'workflowStartedById',
        'approvalAvailableAt'
      )
  `);

  for (const row of columns) {
    requiredColumns.delete(row.column_name);
  }

  const statuses = await prisma.$queryRawUnsafe(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'AgentRunStatus'
  `);

  const statusNames = new Set(statuses.map((row) => row.enumlabel));
  const missing = [];

  if (requiredColumns.size) {
    missing.push(`AgentRun columns: ${[...requiredColumns].join(', ')}`);
  }

  if (!statusNames.has('queued_for_start')) {
    missing.push('AgentRunStatus value: queued_for_start');
  }

  if (missing.length) {
    throw new Error(
      `Production schema is not compatible with this deployment. Missing ${missing.join('; ')}.`
    );
  }

  console.log('[schema-check] Agent workflow schema is compatible.');
}

main()
  .catch((error) => {
    console.error(`[schema-check] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
