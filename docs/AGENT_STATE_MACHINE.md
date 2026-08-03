# AI agent workflow state machine

The database is the source of truth. Realtime and polling only transport persisted changes to the dashboard.

## Trace states

| State | Meaning | Terminal/waiting | Allowed next states |
| --- | --- | --- | --- |
| `active` | Request accepted and work is being prepared | Active | `awaiting_approval`, `executing`, `completed`, `partially_completed`, `failed`, `deduplicated`, `cancelled` |
| `awaiting_approval` | A persisted plan has proposed actions | Waiting for human action | `executing`, `completed`, `partially_completed`, `failed`, `deduplicated`, `cancelled` |
| `executing` | At least one approved action is executing | Active | `completed`, `partially_completed`, `failed`, `cancelled` |
| `completed` | All work finished or all requested actions were rejected | Terminal | None |
| `partially_completed` | At least one action succeeded and another failed | Terminal | None |
| `failed` | Planning, policy, or execution failed | Terminal | None |
| `deduplicated` | This request reused an existing run | Terminal | None |
| `cancelled` | Work was explicitly cancelled | Terminal | None |

## Run and action states

Runs use `planned -> awaiting_approval -> executing -> completed|partially_completed|failed|cancelled`.
Actions use `proposed -> approved|rejected|skipped`, `approved -> executing|rejected|skipped`, and `executing -> completed|failed|skipped`. Terminal states cannot transition back to active states.

## Presentation rules

The backend returns `presentation.pipeline`, derived from the trace, run, actions, and ordered event registry. A terminal trace cannot render an active stage. A deduplicated trace displays `Existing run reused`, links to the original run when available, and marks planning/execution as skipped. An awaiting-approval trace displays `Human approval required`; a safely skipped reminder is an action state of `skipped`, not a failure.

## Invariants

Invariant validation is implemented in `agent-state-machine.service.js` and exposed through `GET /api/admin/agents/integrity`. Safe relationship/status repairs are available through the dry-run-first reconciliation service. Repairs never approve, execute, recreate, or delete clinical workflow records.
