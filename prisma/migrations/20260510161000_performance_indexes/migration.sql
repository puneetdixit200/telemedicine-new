CREATE INDEX IF NOT EXISTS "User_role_isActive_fullName_idx"
ON "User"("role", "isActive", "fullName");

CREATE INDEX IF NOT EXISTS "Appointment_doctorId_status_startAt_idx"
ON "Appointment"("doctorId", "status", "startAt");

CREATE INDEX IF NOT EXISTS "Appointment_patientId_status_startAt_idx"
ON "Appointment"("patientId", "status", "startAt");

CREATE INDEX IF NOT EXISTS "Appointment_status_startAt_idx"
ON "Appointment"("status", "startAt");

CREATE INDEX IF NOT EXISTS "CallSession_status_startedAt_idx"
ON "CallSession"("status", "startedAt");

CREATE INDEX IF NOT EXISTS "Document_ownerId_createdAt_idx"
ON "Document"("ownerId", "createdAt");

CREATE INDEX IF NOT EXISTS "Document_ownerId_familyMemberId_createdAt_idx"
ON "Document"("ownerId", "familyMemberId", "createdAt");
