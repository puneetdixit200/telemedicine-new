# Agentic Care Journey Agents

This document explains the two AI-assisted care coordination agents implemented in this repository:

- No-Show Recovery Agent
- Post-Consultation Follow-Up Agent

Both agents are approval-first. They draft plans and propose fixed server-defined actions, but they do not write anything patient-facing until a doctor or administrator approves and executes the action.

## Core Rules

The implementation follows these safety rules:

- The agents do not diagnose patients.
- The agents do not create new treatment instructions.
- The agents do not add, remove, or modify medicines.
- The agents do not change dosage, frequency, or duration.
- Every patient-facing write requires doctor or administrator approval.
- The browser never receives AI provider keys, Supabase service keys, database URLs, or JWT secrets.
- The system uses only server-defined tools.
- Every run and action is idempotent so retrying the same request does not duplicate work.
- AI failure does not stop the workflow; deterministic fallback plans are generated.
- Queued messages are only marked as queued inside the app. The system does not claim WhatsApp or SMS delivery.

## Main Files

Backend:

- `apps/backend/services/agent-context.service.js`
- `apps/backend/services/agent-planner.service.js`
- `apps/backend/services/agent-policy.service.js`
- `apps/backend/services/agent-actions.service.js`
- `apps/backend/services/agent-orchestrator.service.js`
- `apps/backend/services/patient-notifications.service.js`
- `apps/backend/controllers/agents.controller.js`
- `apps/backend/routes/agents.routes.js`
- `apps/backend/controllers/patients.controller.js`
- `apps/backend/routes/patients.routes.js`

Frontend:

- `apps/frontend/src/components/AgentPlanPanel.jsx`
- `apps/frontend/src/components/PatientNotificationBanner.jsx`
- `apps/frontend/src/App.jsx`
- `apps/frontend/src/styles.css`

Database:

- `prisma/schema.prisma`
- `prisma/migrations/20260729000000_add_agent_workflows/migration.sql`

Tests:

- `tests/agent-planner.test.js`
- `tests/agents.integration.test.js`
- `tests/patient-notifications.test.js`

## Database Model

The agents store their workflow state in two Prisma models.

### AgentRun

`AgentRun` is one complete agent workflow for one appointment.

Important fields:

- `agentType`: `no_show_recovery` or `post_visit_follow_up`
- `status`: workflow state, such as `awaiting_approval`, `executing`, `completed`, or `failed`
- `dedupeKey`: unique key that prevents duplicate runs for the same appointment state
- `appointmentId`: appointment being handled
- `requestedById`: doctor or admin who requested the plan
- `input`: user preference input, such as preferred language
- `context`: server-loaded appointment, patient, doctor, prescription, and slot context
- `plan`: generated AI or fallback plan
- `summary`: short human-readable summary
- `completedAt`: set when all actions finish or fail

### AgentAction

`AgentAction` is one proposed server-side action inside an agent run.

Important fields:

- `toolName`: fixed backend tool name
- `title` and `description`: shown in the approval UI
- `arguments`: server-proposed tool arguments
- `riskLevel`: approval risk label
- `requiresApproval`: true for patient-facing actions
- `status`: `proposed`, `approved`, `rejected`, `executing`, `completed`, or `failed`
- `idempotencyKey`: unique key used by tools to avoid duplicate writes
- `approvedById`, `approvedAt`, `executedAt`: audit fields
- `result` and `error`: execution outcome

## Shared Workflow

Both agents follow the same high-level flow.

1. A doctor or administrator opens an appointment.
2. The frontend shows `AgentPlanPanel` when the appointment context supports an agent action.
3. The user clicks the relevant agent button.
4. The frontend calls the backend plan API.
5. The backend loads trusted context from the database.
6. Policy checks confirm the actor is allowed to generate a plan.
7. The planner asks the existing AI provider service for a JSON draft.
8. If AI is unavailable or returns invalid output, the deterministic fallback creates the plan.
9. The backend stores an `AgentRun` and proposed `AgentAction` rows.
10. The doctor or admin reviews the plan and selected actions in `AgentPlanPanel`.
11. The doctor or admin approves or rejects actions.
12. Approved actions are executed by fixed server-side tools.
13. The patient-facing message is saved as a queued in-app message.
14. The patient sees the message through `PatientNotificationBanner`.
15. The patient can dismiss the notification, which marks metadata on the queued message.

## No-Show Recovery Agent

### Purpose

The No-Show Recovery Agent helps staff recover a missed consultation. It drafts a respectful message and provides a quick rebooking path. It does not rebook the appointment by itself.

### Trigger

The doctor or admin clicks the no-show follow-up action from an appointment screen.

Backend endpoint:

```text
POST /api/agents/no-show/:appointmentId/plan
POST /api/v1/agents/no-show/:appointmentId/plan
```

### Context Loaded

`loadNoShowContext()` loads:

- appointment details
- patient details
- doctor details
- available future slots
- prior no-show count
- quick rebooking path

If the appointment is still `booked`, the orchestrator marks it as `no_show` and cancels scheduled reminders for that appointment before creating the recovery plan.

### Planning

`planNoShowRecovery()` asks the existing OpenRouter/Ollama-compatible provider through `aiGenerate()` for JSON containing:

- summary
- patient recovery message
- rationale
- safety notes

The prompt tells the model:

- do not diagnose
- do not provide treatment
- use only supplied appointment and slot context
- do not claim a slot is booked
- ask the patient to confirm or use the rebooking path

### Deterministic Fallback

If the AI provider fails, times out, or returns invalid JSON, `buildNoShowFallback()` creates a safe message using:

- patient name
- doctor name
- available appointment slot labels
- quick rebooking path

The fallback sets:

```text
fallbackUsed: true
model: deterministic-fallback
```

### Proposed Action

The agent proposes one action:

```text
queue_no_show_recovery_message
```

This action saves an outbound message in the patient consultation thread with `deliveryStatus = queued`.

It does not send WhatsApp or SMS. It only queues an in-app patient-facing message after approval.

## Post-Consultation Follow-Up Agent

### Purpose

The Post-Consultation Follow-Up Agent turns a doctor-authored prescription into a patient-friendly follow-up summary and schedules or refreshes a reminder based on existing prescription data.

It never changes prescription content.

### Trigger

The doctor or admin clicks the post-visit follow-up action after a consultation has a prescription.

Backend endpoint:

```text
POST /api/agents/post-visit/:appointmentId/plan
POST /api/v1/agents/post-visit/:appointmentId/plan
```

### Context Loaded

`loadPostVisitContext()` loads:

- appointment details
- patient details
- doctor details
- prescription
- prescription medicines
- follow-up date, if present

The policy layer requires a completed consultation and a doctor-authored prescription before this agent can create a plan.

### Planning

`planPostVisitFollowUp()` asks the existing AI provider for a JSON draft that simplifies doctor-authored information.

The prompt tells the model:

- do not diagnose
- do not recommend new treatment
- do not add medicines
- do not remove medicines
- do not modify dosage, frequency, duration, diagnosis, or follow-up timing
- all output is only a draft requiring clinician approval

### Medication Fidelity Check

After AI output is parsed, the backend merges only the plain-language explanation with the original prescription items.

`validateMedicationFidelity()` verifies that each generated medicine entry still matches the original:

- name
- dosage
- frequency
- duration

If any value changes, planning falls back to the deterministic plan.

### Deterministic Fallback

If AI is unavailable or unsafe, `buildPostVisitFallback()` creates a summary from the prescription exactly as written.

For each medicine it creates:

```text
Take [name] exactly as prescribed: [dosage], [frequency], for [duration].
```

The fallback includes a generic urgent-care warning and sets:

```text
fallbackUsed: true
model: deterministic-fallback
```

### Proposed Actions

The agent proposes two actions:

```text
queue_post_visit_summary
schedule_refill_reminder
```

`queue_post_visit_summary` saves the approved follow-up summary as a queued patient-facing in-app message.

`schedule_refill_reminder` refreshes the existing refill reminder job using existing prescription and appointment data. It does not invent new prescription timing.

## Approval APIs

After a plan is created, these routes manage review and execution:

```text
GET  /api/agents/runs/:runId
POST /api/agents/runs/:runId/approve
POST /api/agents/runs/:runId/reject
POST /api/agents/runs/:runId/execute

GET  /api/v1/agents/runs/:runId
POST /api/v1/agents/runs/:runId/approve
POST /api/v1/agents/runs/:runId/reject
POST /api/v1/agents/runs/:runId/execute
```

Expected frontend sequence:

1. Create a plan.
2. Show proposed actions to doctor or admin.
3. Approve selected action IDs.
4. Execute approved actions.
5. Refresh the run to show completed or failed action status.

## Patient Notification APIs

Patients see approved queued messages through:

```text
GET /api/patients/notifications
POST /api/patients/notifications/:messageId/dismiss
```

Only logged-in patients can call these routes.

The notification service returns queued outbound messages that:

- belong to the current patient
- have a non-empty body
- are not dismissed
- have `deliveryStatus = queued`

Dismissal stores `patientDismissedAt` in message metadata. It does not delete the message.

## Frontend Behavior

### AgentPlanPanel

`AgentPlanPanel` is the doctor/admin approval interface.

It shows:

- plan summary
- whether deterministic fallback was used
- model name
- proposed actions
- action risk level
- approval and rejection controls
- execution state

The panel intentionally does not expose arbitrary tool execution. It only sends action IDs for backend-defined actions already saved in `AgentAction`.

### PatientNotificationBanner

`PatientNotificationBanner` appears for patient accounts when queued notifications exist.

It:

- stays centered in the viewport
- shows the latest queued care update
- links to the related appointment when available
- supports dismissing the notification
- supports minimizing the notification
- does not claim external delivery

## Idempotency and Concurrency

The implementation has two layers of duplicate protection.

### AgentRun Dedupe

Each run has a unique `dedupeKey`.

No-show key format:

```text
no_show_recovery:[appointmentId]:[appointmentUpdatedAtEpoch]
```

Post-visit key format:

```text
post_visit_follow_up:[appointmentId]:[prescriptionUpdatedAtEpoch]
```

If the same plan request is retried for the same state, the existing `AgentRun` is returned.

### AgentAction Claiming

Execution uses an atomic update:

```text
status = approved -> executing
```

Only the request that successfully claims the action executes it. Concurrent retries skip actions already claimed or completed.

The action tools also use `idempotencyKey` metadata so repeated execution does not create duplicate queued messages or reminder jobs.

## Security and Policy

Policy checks live in `agent-policy.service.js`.

They enforce:

- only doctors and admins can create or approve agent runs
- only allowed appointment states can trigger each agent
- only server-defined tool names are executable
- medication content must match the doctor-authored prescription

The frontend can request approval or execution, but the backend is the source of truth for permissions, allowed tools, and action arguments.

## How To Test Locally

Run the standard verification commands:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npx prisma migrate status
npm run lint
npm test
npm run build
npm run test:e2e
```

Useful focused tests:

```bash
npm test -- tests/agent-planner.test.js
npm test -- tests/agents.integration.test.js
npm test -- tests/patient-notifications.test.js
```

## How To See The Agents Working

### Doctor/Admin Side

1. Log in as a doctor or administrator.
2. Open an appointment.
3. For a missed appointment, click the no-show follow-up action.
4. Review the generated plan in `AgentPlanPanel`.
5. Approve the proposed action.
6. Execute approved actions.
7. Confirm the action status becomes completed.

For post-consultation follow-up:

1. Open a completed consultation with a prescription.
2. Click the post-visit follow-up agent action.
3. Review the summary and reminder actions.
4. Approve and execute selected actions.

### Patient Side

1. Log in as the patient linked to the appointment.
2. Open the dashboard.
3. The centered care update notification appears if an approved queued message exists.
4. Click `Open appointment` to view the appointment.
5. Click `Dismiss` to hide the notification.

## Deployment Notes

The MVP is compatible with the existing Vercel and Supabase path:

- Prisma migration is SQL-based and works with Supabase Postgres.
- Runtime uses the existing Node/Next/Express compatibility API.
- No separate Python service is required.
- No cron is required for the MVP.
- AI provider secrets stay server-side.
- Fallback planning works without OpenRouter/Ollama availability.

