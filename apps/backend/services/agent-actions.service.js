const { prisma } = require('../models/db');
const { scheduleRefillReminderForAppointment } = require('./reminder.service');
const { assertAllowedTool, assertCanManageAppointment } = require('./agent-policy.service');

function clean(value) {
  return String(value || '').trim();
}

async function queueExternalMessage({ action, actor, metadataType }) {
  const appointmentId = clean(action.arguments?.appointmentId);
  const body = clean(action.arguments?.body);
  if (!appointmentId || appointmentId !== action.run.appointmentId) {
    throw new Error('Action appointment does not match the agent run.');
  }
  if (!body || body.length > 2400) {
    throw new Error('Patient message must be between 1 and 2400 characters.');
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true, doctor: true }
  });
  assertCanManageAppointment(actor, appointment);
  if (!clean(appointment.patient?.phone)) {
    throw new Error('Patient phone is missing, so an external message cannot be queued.');
  }

  return prisma.$transaction(async (tx) => {
    const thread = await tx.externalConsultThread.upsert({
      where: { appointmentId },
      update: {
        channel: 'whatsapp',
        contactPhone: appointment.patient.phone
      },
      create: {
        appointmentId,
        patientId: appointment.patientId,
        channel: 'whatsapp',
        contactPhone: appointment.patient.phone
      }
    });

    const message = await tx.externalConsultMessage.create({
      data: {
        threadId: thread.id,
        direction: 'outbound',
        body,
        syncedById: actor.id,
        deliveryStatus: 'queued',
        metadata: {
          ...(action.arguments?.metadata || {}),
          type: metadataType,
          agentRunId: action.runId,
          agentActionId: action.id
        }
      }
    });

    await tx.externalConsultThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() }
    });

    return {
      threadId: thread.id,
      messageId: message.id,
      deliveryStatus: 'queued'
    };
  });
}

async function queueNoShowRecoveryMessage({ action, actor }) {
  return queueExternalMessage({ action, actor, metadataType: 'agent_no_show_recovery' });
}

async function queuePostVisitSummary({ action, actor }) {
  const body = clean(action.arguments?.body);
  if (!body.includes('Follow the prescription exactly.')) {
    throw new Error('Post-visit summary must remind the patient to follow the prescription exactly.');
  }
  return queueExternalMessage({ action, actor, metadataType: 'agent_post_visit_summary' });
}

async function scheduleRefillReminder({ action, actor }) {
  const appointmentId = clean(action.arguments?.appointmentId);
  if (!appointmentId || appointmentId !== action.run.appointmentId) {
    throw new Error('Action appointment does not match the agent run.');
  }
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } });
  assertCanManageAppointment(actor, appointment);
  const result = await scheduleRefillReminderForAppointment(appointmentId);
  return {
    scheduled: Number(result?.scheduled || 0),
    reason: result?.reason || null,
    appointmentId
  };
}

const TOOL_REGISTRY = {
  queue_no_show_recovery_message: queueNoShowRecoveryMessage,
  queue_post_visit_summary: queuePostVisitSummary,
  schedule_refill_reminder: scheduleRefillReminder
};

async function executeAllowedTool({ action, actor }) {
  assertAllowedTool(action.run.agentType, action.toolName);
  const tool = TOOL_REGISTRY[action.toolName];
  if (!tool) throw new Error('Agent action tool is not registered.');
  return tool({ action, actor });
}

module.exports = {
  TOOL_REGISTRY,
  executeAllowedTool,
  queueNoShowRecoveryMessage,
  queuePostVisitSummary,
  scheduleRefillReminder
};
