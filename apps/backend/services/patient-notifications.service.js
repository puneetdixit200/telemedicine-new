const { prisma } = require('../models/db');

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

  return filterVisiblePatientNotifications(messages).map((message) => ({
    id: message.id,
    appointmentId: message.thread?.appointmentId || null,
    body: message.body,
    createdAt: message.createdAt,
    metadata: metadataObject(message.metadata)
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

  return { ok: true };
}

module.exports = {
  filterVisiblePatientNotifications,
  markNotificationDismissed,
  listPatientNotifications,
  dismissPatientNotification
};
