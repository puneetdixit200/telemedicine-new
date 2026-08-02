-- The application maps Supabase auth IDs to User.supabaseAuthUserId. Use the
-- immutable app_metadata role claim for Realtime authorization, with the
-- mapped database role as a defensive compatibility fallback.
DROP POLICY IF EXISTS "Admins can read agent execution traces" ON "AgentExecutionTrace";
DROP POLICY IF EXISTS "Admins can read agent execution events" ON "AgentExecutionEvent";

CREATE POLICY "Admins can read agent execution traces"
  ON "AgentExecutionTrace" FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR EXISTS (
        SELECT 1 FROM public."User" u
        WHERE u."supabaseAuthUserId" = auth.uid()::TEXT
          AND u."role" = 'admin'
          AND u."isActive" = TRUE
      )
    )
  );

CREATE POLICY "Admins can read agent execution events"
  ON "AgentExecutionEvent" FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR EXISTS (
        SELECT 1 FROM public."User" u
        WHERE u."supabaseAuthUserId" = auth.uid()::TEXT
          AND u."role" = 'admin'
          AND u."isActive" = TRUE
      )
    )
  );
