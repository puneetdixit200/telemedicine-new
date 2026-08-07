UPDATE "AgentExecutionStep"
SET sequence = sequence + 100
WHERE sequence BETWEEN 1 AND 99
  AND "stepKey" NOT IN (
    'trigger',
    'context',
    'policy',
    'deduplication',
    'planning',
    'validation',
    'persistence',
    'approval',
    'execution',
    'notification',
    'completion'
  );

CREATE OR REPLACE FUNCTION "telemedicine_namespace_agent_execution_step"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  expected_macro_sequence INTEGER;
BEGIN
  expected_macro_sequence := CASE NEW."stepKey"
    WHEN 'trigger' THEN 1
    WHEN 'context' THEN 2
    WHEN 'policy' THEN 3
    WHEN 'deduplication' THEN 4
    WHEN 'planning' THEN 5
    WHEN 'validation' THEN 6
    WHEN 'persistence' THEN 7
    WHEN 'approval' THEN 8
    WHEN 'execution' THEN 9
    WHEN 'notification' THEN 10
    WHEN 'completion' THEN 11
    ELSE NULL
  END;

  IF expected_macro_sequence IS NOT NULL THEN
    NEW.sequence := expected_macro_sequence;
  ELSIF NEW.sequence < 100 THEN
    NEW.sequence := NEW.sequence + 100;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AgentExecutionStep_namespace_no_show_sequence" ON "AgentExecutionStep";
DROP TRIGGER IF EXISTS "AgentExecutionStep_namespace_sequence" ON "AgentExecutionStep";

CREATE TRIGGER "AgentExecutionStep_namespace_sequence"
BEFORE INSERT OR UPDATE OF sequence, "stepKey", "runId"
ON "AgentExecutionStep"
FOR EACH ROW
EXECUTE FUNCTION "telemedicine_namespace_agent_execution_step"();

ALTER TABLE "AgentExecutionStep"
DROP CONSTRAINT IF EXISTS "AgentExecutionStep_sequence_namespace_check";

ALTER TABLE "AgentExecutionStep"
ADD CONSTRAINT "AgentExecutionStep_sequence_namespace_check"
CHECK ((sequence BETWEEN 1 AND 11) OR sequence >= 100);
