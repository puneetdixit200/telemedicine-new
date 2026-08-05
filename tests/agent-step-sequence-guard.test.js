'use strict';

const fs = require('fs');
const path = require('path');

describe('no-show execution step sequence guard', () => {
  const migrationPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260805000300_namespace_no_show_execution_steps',
    'migration.sql'
  );

  it('namespaces detailed no-show steps away from the eleven macro presentation steps', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('telemedicine_namespace_no_show_execution_step_sequence');
    expect(migration).toContain('AgentExecutionStep_namespace_no_show_sequence');
    expect(migration).toContain("'no_show_recovery'::\"AgentType\"");
    expect(migration).toContain('NEW.sequence BETWEEN 1 AND 99');
    expect(migration).toContain('NEW.sequence := NEW.sequence + 100');
    expect(migration).toContain("'trigger'");
    expect(migration).toContain("'completion'");
  });

  it('keeps the existing runId plus sequence uniqueness guard intact', () => {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

    expect(schema).toContain('@@unique([runId, sequence])');
    expect(schema).toContain('@@unique([runId, stepKey])');
  });
});
