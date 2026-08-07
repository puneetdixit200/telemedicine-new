# AI Agent Workflow State Machine

The database is the source of truth for agent workflow state. Supabase Realtime and polling only transport persisted state to the admin dashboard.

For the complete product explanation and diagrams, see [Agentic Care Journey Agents](AGENTIC_CARE_JOURNEY_AGENTS.md).

Editable diagrams: [`diagrams/AI_AGENT_WORKFLOWS.drawio`](diagrams/AI_AGENT_WORKFLOWS.drawio).

## Why There Are Multiple State Layers

The agent system tracks several related but different things:

- **Trace**: observability record for one request/attempt.
- **Run**: the durable logical agent workflow.
- **Action**: one proposed/approved server-side tool operation.
- **Execution step**: durable fine-grained execution progress.
- **Presentation state**: the human-readable pipeline shown in the admin console.

These are intentionally separate. A browser animation must never become the source of truth for clinical workflow execution.

## Run States

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `queued_for_start` | No-show ticket exists, but an administrator has not started AI planning | `planned`, `failed`, `cancelled` |
| `planned` | Admin has started the run and planning is being prepared/completed | `awaiting_approval`, `failed`, `cancelled` |
| `awaiting_approval` | Persisted plan/draft/actions are ready for human review | `executing`, `completed`, `partially_completed`, `failed`, `cancelled` |
| `executing` | One or more approved actions are being executed | `completed`, `partially_completed`, `failed`, `cancelled` |
| `completed` | Workflow finished successfully | terminal |
| `partially_completed` | Some approved work succeeded and some failed/skipped | terminal |
| `failed` | Planning, policy, validation, or execution failed | terminal unless an explicit safe retry path creates/resumes an eligible attempt |
| `cancelled` | Workflow was intentionally stopped/rejected | terminal |

The no-show happy path is:

```text
queued_for_start
      ↓ admin Start Workflow
planned
      ↓ planning + validated persisted draft
awaiting_approval
      ↓ admin Approve and Continue
executing
      ↓ delivery gate + exactly-once patient result
completed
```

## Trace States

| State | Meaning | Terminal/waiting | Allowed next states |
| --- | --- | --- | --- |
| `active` | Request/ticket exists and may be waiting for start or doing work | Active | `awaiting_approval`, `executing`, `completed`, `partially_completed`, `failed`, `deduplicated`, `cancelled` |
| `awaiting_approval` | Persisted plan has proposed actions and requires human review | Waiting | `executing`, `completed`, `partially_completed`, `failed`, `deduplicated`, `cancelled` |
| `executing` | Approved work is running | Active | `completed`, `partially_completed`, `failed`, `cancelled` |
| `completed` | Trace finished successfully | Terminal | none |
| `partially_completed` | Mixed final outcome | Terminal | none |
| `failed` | Planning/policy/execution failed | Terminal | none |
| `deduplicated` | Request reused an existing run | Terminal | none |
| `cancelled` | Workflow was explicitly cancelled/rejected | Terminal | none |

A newly created no-show ticket can have an `active` trace while its run is still `queued_for_start`. The admin presentation projection uses `workflowStartedAt` and persisted run state so the visible pipeline remains **Not started** until an administrator actually starts it.

## Action States

Actions follow:

```text
proposed
   ├─> approved ─> executing ─> completed
   │                         ├─> failed
   │                         └─> skipped
   ├─> rejected
   └─> skipped
```

Terminal action states are:

```text
completed
failed
rejected
skipped
```

Only fixed backend tools can be proposed/executed.

## Human Gates

### Gate 1: Start Workflow

For the no-show recovery path, creating a doctor-side recovery ticket does not automatically run the AI planner.

Admin-only endpoint:

```text
POST /api/admin/agents/runs/:runId/start
POST /api/v1/admin/agents/runs/:runId/start
```

The admin route family is protected by authentication plus `roleRequired('admin')`.

### Gate 2: Approve and Continue

After planning is complete, the run stops at `awaiting_approval`.

Admin-only endpoint:

```text
POST /api/admin/agents/runs/:runId/approve-and-continue
POST /api/v1/admin/agents/runs/:runId/approve-and-continue
```

The backend verifies the persisted draft/action/state before execution. A disabled frontend button is not the authorization mechanism.

## Presentation Pipeline

The admin dashboard presents the macro pipeline:

```text
1. Triggered
2. Context loaded
3. Policy validated
4. Deduplication checked
5. AI model called
6. Output validated
7. Plan saved
8. Awaiting approval
9. Actions executing
10. Patient result
11. Completed
```

Before admin Start, every stage is presented as `Not started` even though audit records may already exist for ticket creation.

The backend derives presentation state from canonical persisted data. The frontend may render countdowns/progress, but frontend timers do not authorize state transitions or patient delivery.

## Actual Timing vs Presentation Timing

The system separates:

- **actual timestamps**: when backend work really happened
- **presentation timestamps**: when a stage is displayed as active/completed in the operations UI

This keeps demonstrations understandable without rewriting real telemetry.

The no-show workflow also enforces an approval timing guard in PostgreSQL so an approval request cannot bypass the configured pre-approval presentation window simply by calling the API directly.

## Execution-Step Namespaces

`AgentExecutionStep` uses disjoint sequence ranges:

- `1-11`: macro presentation stages
- `101+`: detailed execution steps

The `12-99` range is intentionally invalid/reserved.

This prevents detailed post-approval execution rows from colliding with presentation-stage rows on the `(runId, sequence)` uniqueness constraint.

Application code uses the correct namespace, and the database contains a defense-in-depth guard so the invariant is not dependent on one call site remembering the convention.

## Deduplication

A repeated request for the same logical occurrence must not generate another patient-facing workflow.

For no-show recovery, deduplication uses the appointment/no-show occurrence state so:

```text
same no-show occurrence + retry/double-click
      → existing run reused
      → deduplicated trace
      → no duplicate AI planning/action/message
```

A later genuine no-show occurrence after rebooking can create a new run.

A deduplicated trace should display `Existing run reused` rather than pretending to execute planning again.

## Fallback Is Not Automatically Failure

AI-provider failure or invalid output can activate deterministic fallback.

A validated deterministic localized fallback is a safe degraded planning result and may still proceed to `awaiting_approval`.

The presentation reducer must therefore distinguish:

```text
AI provider/model issue recovered by fallback
```

from:

```text
workflow failed without a safe plan
```

## Notification Invariant

For the no-show workflow, the patient message must not exist:

- when the ticket is created
- while waiting for admin Start
- during planning
- while awaiting approval
- during pre-delivery execution

The patient-facing message is created only after the approved final delivery gate succeeds.

The delivery path remains idempotent so retries cannot create duplicate patient messages.

## Retry and Recovery

The system includes a safe retry path for eligible failed no-show executions.

Retry must verify that repeating the operation is safe. In particular it must avoid re-creating a patient-visible side effect that already exists.

State reconciliation is separate from execution. Reconciliation may repair safe metadata/relationship inconsistencies, but it must never silently approve, execute, recreate, or delete clinical workflow records.

## Integrity Invariants

Invariant validation is implemented in `agent-state-machine.service.js` and exposed through:

```text
GET /api/admin/agents/integrity
```

Safe relationship/status repair is available through the dry-run-first reconciliation service.

Important integrity checks include:

- terminal traces have completion timestamps
- active/awaiting traces have the expected run/action relationship
- deduplicated traces link to a reused run
- deduplicated requests do not contain execution events that imply duplicate work
- executing runs contain active approved actions
- completed runs do not retain unfinished actions
- delivery/result state is internally consistent
- execution-step sequence namespaces remain disjoint

## Historical Records

Old deployments may contain records created before later integrity metadata existed.

A historical unresolved record should be classified explicitly rather than having an invented relationship written into history.

The admin console may display these as terminal historical records that require no operational action when they have no active side effects.

## State Ownership Rule

The most important rule is:

> PostgreSQL owns workflow truth. Realtime, polling, React state, animations, and browser clocks are presentation/transport mechanisms only.

That rule is what allows refresh, reconnect, retries, and operational recovery without turning the UI into the workflow engine.
