const { prisma } = require('../models/db');
const { safeRecordAgentEvent } = require('./agent-observability.service');

function metadataObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function filterVisiblePatientNotifications(messages) {
  return (messages || []).filter((message) => {
    const metadata = metadataObject(message.metadata);
    return (
      message.direction === 'outbound' &&
      message.deliveryStatus === 'queued' &&
      !metadata.patientDismissedAt &&
      String(message.body || '').trim()
    );
  });
}

function markNotificationDismissed(metadata = {}) {
  return {
    ...metadataObject(metadata),
    patientDismissedAt: new Date().toISOString()
  };
}

async function listPatientNotifications(patientId) {
  const messages = await prisma.externalConsultMessage.findMany({
    where: {
      direction: 'outbound',
      deliveryStatus: 'queued',
      thread: { patientId }
    },
    include: {
      thread: {
        select: {
          appointmentId: true
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  const visible = filterVisiblePatientNotifications(messages);
  return Promise.all(visible.map(async (message) => {
    const metadata = metadataObject(message.metadata);
    const trace = metadata.agentRunId
      ? await prisma.agentExecutionTrace.findFirst({ where: { runId: metadata.agentRunId, status: { not: 'deduplicated' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, runId: true } })
      : null;
    if (trace) {
      const existing = await prisma.agentExecutionEvent.findFirst({
        where: { traceId: trace.id, eventType: 'notification_visible_to_patient', metadata: { path: ['messageId'], equals: message.id } },
        select: { id: true }
      });
      if (!existing) {
        await safeRecordAgentEvent({ traceId: trace.id, runId: trace.runId, phase: 'notification', eventType: 'notification_visible_to_patient', status: 'completed', title: 'Notification visible to patient', metadata: { messageId: message.id } });
      }
    }
    return {
      id: message.id,
      appointmentId: message.thread?.appointmentId || null,
      body: message.body,
      title: message.title || metadata.notificationTitle || 'Care update from your clinic',
      createdAt: message.createdAt,
      metadata
    };
  }));
}

async function dismissPatientNotification({ patientId, messageId }) {
  const message = await prisma.externalConsultMessage.findFirst({
    where: {
      id: messageId,
      direction: 'outbound',
      deliveryStatus: 'queued',
      thread: { patientId }
    },
    select: {
      id: true,
      metadata: true
    }
  });

  if (!message) {
    const error = new Error('Notification not found.');
    error.status = 404;
    error.code = 'NOTIFICATION_NOT_FOUND';
    throw error;
  }

  await prisma.externalConsultMessage.update({
    where: { id: message.id },
    data: {
      metadata: markNotificationDismissed(message.metadata)
    }
  });

  const metadata = metadataObject(message.metadata);
  if (metadata.agentRunId) {
    const trace = await prisma.agentExecutionTrace.findFirst({ where: { runId: metadata.agentRunId, status: { not: 'deduplicated' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, runId: true } });
    if (trace) {
      await safeRecordAgentEvent({ traceId: trace.id, runId: trace.runId, phase: 'notification', eventType: 'notification_dismissed', status: 'completed', title: 'Notification dismissed by patient', metadata: { messageId: message.id } });
    }
  }

  return { ok: true };
}

module.exports = {
  filterVisiblePatientNotifications,
  markNotificationDismissed,
  listPatientNotifications,
  dismissPatientNotification
};
