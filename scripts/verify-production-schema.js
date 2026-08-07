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

  const triggers = await prisma.$queryRawUnsafe(`
    SELECT trigger_name
    FROM information_schema.triggers
    WHERE event_object_schema = 'public'
      AND event_object_table IN ('AgentRun', 'AgentExecutionStep')
  `);

  const constraints = await prisma.$queryRawUnsafe(`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'AgentExecutionStep'
      AND constraint_name = 'AgentExecutionStep_sequence_namespace_check'
  `);

  const namespaceViolations = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*) FILTER (WHERE sequence BETWEEN 12 AND 99) AS ambiguous_sequences,
      COUNT(*) FILTER (
        WHERE sequence BETWEEN 1 AND 11
          AND "stepKey" NOT IN (
            'trigger', 'context', 'policy', 'deduplication', 'planning',
            'validation', 'persistence', 'approval', 'execution',
            'notification', 'completion'
          )
      ) AS detailed_steps_in_macro_namespace
    FROM "AgentExecutionStep"
  `);

  const statusNames = new Set(statuses.map((row) => row.enumlabel));
  const triggerNames = new Set(triggers.map((row) => row.trigger_name));
  const constraintNames = new Set(constraints.map((row) => row.constraint_name));
  const namespaceRow = namespaceViolations[0] || {};
  const missing = [];

  if (requiredColumns.size) {
    missing.push(`AgentRun columns: ${[...requiredColumns].join(', ')}`);
  }

  if (!statusNames.has('queued_for_start')) {
    missing.push('AgentRunStatus value: queued_for_start');
  }

  if (!triggerNames.has('AgentRun_enforce_approval_window')) {
    missing.push('AgentRun trigger: AgentRun_enforce_approval_window');
  }

  if (!triggerNames.has('AgentExecutionStep_namespace_sequence')) {
    missing.push('AgentExecutionStep trigger: AgentExecutionStep_namespace_sequence');
  }

  if (triggerNames.has('AgentExecutionStep_namespace_no_show_sequence')) {
    missing.push('legacy AgentExecutionStep namespace trigger must be removed');
  }

  if (!constraintNames.has('AgentExecutionStep_sequence_namespace_check')) {
    missing.push('AgentExecutionStep constraint: AgentExecutionStep_sequence_namespace_check');
  }

  if (Number(namespaceRow.ambiguous_sequences || 0) > 0) {
    missing.push(`ambiguous AgentExecutionStep sequences: ${namespaceRow.ambiguous_sequences}`);
  }

  if (Number(namespaceRow.detailed_steps_in_macro_namespace || 0) > 0) {
    missing.push(`detailed steps in macro namespace: ${namespaceRow.detailed_steps_in_macro_namespace}`);
  }

  if (missing.length) {
    throw new Error(
      `Production schema is not compatible with this deployment. Missing or invalid: ${missing.join('; ')}.`
    );
  }

  console.log('[schema-check] Agent workflow schema, approval timing guard, and disjoint execution step namespaces are compatible.');
}

main()
  .catch((error) => {
    console.error(`[schema-check] ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
