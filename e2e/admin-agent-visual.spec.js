const { expect, test } = require('@playwright/test');

const PRE_APPROVAL = ['trigger', 'context', 'policy', 'deduplication', 'planning', 'validation', 'persistence'];
const POST_APPROVAL = ['execution', 'notification', 'completion'];

test('admin pipeline visibly advances for four seconds per stage even when the backend finishes early', async ({ page }) => {
  const trace = {
    id: 'visual-trace-1',
    agentType: 'no_show_recovery',
    appointmentId: 'visual-appointment-1',
    status: 'active',
    updatedAt: new Date().toISOString(),
    events: [],
    run: {
      id: 'visual-run-1',
      agentType: 'no_show_recovery',
      status: 'queued_for_start',
      actions: [],
      executionSteps: []
    },
    presentation: { pipeline: {}, approvalReady: false, approvalRemainingMs: 0 }
  };

  await page.route('**/api/session', (route) => route.fulfill({ json: {
    user: { id: 'visual-admin-1', role: 'admin', fullName: 'Visual Test Admin' }
  } }));
  await page.route('**/api/admin/agents/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/realtime-token')) return route.fulfill({ status: 503, json: { error: 'Polling test' } });
    if (path.endsWith('/overview')) return route.fulfill({ json: { overview: { activeRuns: 1 } } });
    if (path.endsWith('/traces') && route.request().method() === 'GET') {
      return route.fulfill({ json: { rows: [trace] } });
    }
    if (path.endsWith(`/traces/${trace.id}`)) return route.fulfill({ json: { trace } });
    if (path.endsWith('/events')) return route.fulfill({ json: { events: [] } });
    if (path.endsWith(`/runs/${trace.run.id}/start`)) {
      trace.status = 'awaiting_approval';
      trace.run.status = 'awaiting_approval';
      trace.run.actions = [{ id: 'visual-action-1', status: 'proposed', title: 'Demo action', toolName: 'demo', riskLevel: 'low' }];
      trace.presentation.approvalReady = true;
      return route.fulfill({ json: { ok: true, run: trace.run } });
    }
    if (path.endsWith(`/runs/${trace.run.id}/approve-and-continue`)) {
      trace.status = 'completed';
      trace.run.status = 'completed';
      trace.run.actions[0].status = 'completed';
      return route.fulfill({ json: { ok: true, run: trace.run } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request' } });
  });

  await page.goto('/admin/ai-agents');
  await expect(page.getByRole('button', { name: 'Start Workflow' })).toBeVisible();
  await page.getByRole('button', { name: 'Start Workflow' }).click();
  await expect(page.locator('.agent-visual-note')).toContainText('Visual simulation');

  for (let index = 0; index < PRE_APPROVAL.length; index += 1) {
    await expect(page.locator(`[data-phase="${PRE_APPROVAL[index]}"]`)).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: /Visual walkthrough:/ })).toBeDisabled();
    await page.waitForTimeout(4100);
    await expect(page.locator(`[data-phase="${PRE_APPROVAL[index]}"]`)).toHaveClass(/completed/);
  }

  await expect(page.locator('[data-phase="approval"]')).toHaveClass(/waiting/);
  await page.reload();
  await expect(page.locator('[data-phase="approval"]')).toHaveClass(/waiting/);
  await page.getByRole('button', { name: 'Approve and Continue' }).click();

  for (const phase of POST_APPROVAL) {
    await expect(page.locator(`[data-phase="${phase}"]`)).toHaveClass(/active/);
    await page.waitForTimeout(4100);
    await expect(page.locator(`[data-phase="${phase}"]`)).toHaveClass(/completed/);
  }
  await expect(page.locator('.agent-visual-note')).toContainText('Backend run: completed');
});
