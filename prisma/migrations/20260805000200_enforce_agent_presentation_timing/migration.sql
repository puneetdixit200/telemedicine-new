CREATE OR REPLACE FUNCTION "telemedicine_enforce_agent_approval_window"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  minimum_approval_at TIMESTAMP;
BEGIN
  IF NEW."agentType" = 'no_show_recovery'::"AgentType"
     AND NEW."workflowStartedAt" IS NOT NULL
     AND NEW."approvalAvailableAt" IS NOT NULL THEN
    minimum_approval_at := NEW."workflowStartedAt" + INTERVAL '40 seconds';

    IF NEW."approvalAvailableAt" < minimum_approval_at THEN
      NEW."approvalAvailableAt" := minimum_approval_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "AgentRun_enforce_approval_window" ON "AgentRun";

CREATE TRIGGER "AgentRun_enforce_approval_window"
BEFORE INSERT OR UPDATE OF "workflowStartedAt", "approvalAvailableAt", "agentType"
ON "AgentRun"
FOR EACH ROW
EXECUTE FUNCTION "telemedicine_enforce_agent_approval_window"();
