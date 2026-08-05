CREATE OR REPLACE FUNCTION "telemedicine_namespace_no_show_execution_step_sequence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  is_no_show_run BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM "AgentRun" r
    WHERE r.id = NEW."runId"
      AND r."agentType" = 'no_show_recovery'::"AgentType"
  ) INTO is_no_show_run;

  IF is_no_show_run
     AND NEW."stepKey" NOT IN (
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
     )
     AND NEW.sequence BETWEEN 1 AND 99 THEN
    NEW.sequence := NEW.sequence + 100;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AgentExecutionStep_namespace_no_show_sequence"
ON "AgentExecutionStep";

CREATE TRIGGER "AgentExecutionStep_namespace_no_show_sequence"
BEFORE INSERT OR UPDATE OF "runId", sequence, "stepKey"
ON "AgentExecutionStep"
FOR EACH ROW
EXECUTE FUNCTION "telemedicine_namespace_no_show_execution_step_sequence"();
