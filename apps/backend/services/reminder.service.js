const { prisma } = require('../models/db');

function isReminderTableMissing(error) {
  return Boolean(
    error &&
      error.code === 'P2021' &&
      String(error.meta?.table || '')
        .toLowerCase()
        .includes('reminderjob')
  );
}

function safeText(value) {
  return String(value || '').trim();
}

function buildReminderPayload(appointment, minutesBefore) {
  const patientName = safeText(appointment.patient?.fullName) || 'Patient';
  const doctorName = safeText(appointment.doctor?.fullName) || 'Doctor';
  const localStart = new Date(appointment.startAt);

  const whenLabel = Number.isNaN(localStart.getTime())
    ? 'soon'
    : `${localStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${localStart.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      })} IST`;

  const leadLabel = minutesBefore >= 60 ? `${Math.round(minutesBefore / 60)} hour` : `${minutesBefore} minutes`;
  const leadPlural = leadLabel.endsWith('s') ? '' : 's';

  return {
    title: 'Telemedicine appointment reminder',
    message: `Namaste ${patientName}. Your consultation with Dr. ${doctorName} starts in ${leadLabel}${leadPlural} at ${whenLabel}. Keep your phone nearby.`,
    appointmentId: appointment.id,
    startAt: appointment.startAt
  };
}

function buildRefillReminderPayload(appointment) {
  const patientName = safeText(appointment.patient?.fullName) || 'Patient';
  const doctorName = safeText(appointment.doctor?.fullName) || 'Doctor';
  const followUpAt = appointment.prescription?.followUpAt ? new Date(appointment.prescription.followUpAt) : null;
  const followUpLabel = followUpAt
    ? `${followUpAt.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${followUpAt.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      })} IST`
    : 'your follow-up date';
  const handoffCode = safeText(appointment.prescription?.handoffCode);

  return {
    title: 'Prescription refill reminder',
    message: handoffCode
      ? `Namaste ${patientName}. Your refill window for Dr. ${doctorName}'s prescription is now active. Follow-up is on ${followUpLabel}. Share handoff code ${handoffCode} with your pharmacy.`
      : `Namaste ${patientName}. Your refill window for Dr. ${doctorName}'s prescription is now active. Follow-up is on ${followUpLabel}.`,
    appointmentId: appointment.id,
    followUpAt: appointment.prescription?.followUpAt || null,
    handoffCode: handoffCode || null
  };
}

async function scheduleRemindersForAppointment(appointmentId) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        doctor: { select: { fullName: true } }
      }
    });

    if (!appointment || appointment.status !== 'booked') {
      return { ok: true, scheduled: 0, reason: 'appointment_not_open' };
    }

    if (!safeText(appointment.patient?.phone)) {
      return { ok: true, scheduled: 0, reason: 'patient_phone_missing' };
    }

    const now = Date.now();
    const startAtMs = new Date(appointment.startAt).getTime();
    if (Number.isNaN(startAtMs) || startAtMs <= now + 60 * 1000) {
      return { ok: true, scheduled: 0, reason: 'appointment_too_soon' };
    }

    const plans = [
      { minutesBefore: 24 * 60, templateKey: 'appointment_24h' },
      { minutesBefore: 30, templateKey: 'appointment_30m' }
    ]
      .map((plan) => {
        const sendAt = new Date(startAtMs - plan.minutesBefore * 60 * 1000);
        return {
          sendAt,
          minutesBefore: plan.minutesBefore,
          templateKey: plan.templateKey
        };
      })
      .filter((plan) => plan.sendAt.getTime() > now + 30 * 1000);

    await prisma.reminderJob.deleteMany({
      where: {
        appointmentId,
        status: 'scheduled'
      }
    });

    if (!plans.length) {
      return { ok: true, scheduled: 0, reason: 'no_future_slots' };
    }

    await prisma.reminderJob.createMany({
      data: plans.map((plan) => ({
        appointmentId,
        patientId: appointment.patientId,
        channel: 'sms',
        sendAt: plan.sendAt,
        templateKey: plan.templateKey,
        payload: buildReminderPayload(appointment, plan.minutesBefore),
        status: 'scheduled'
      }))
    });

    return { ok: true, scheduled: plans.length };
  } catch (error) {
    if (isReminderTableMissing(error)) {
      return { ok: false, unsupported: true };
    }
    throw error;
  }
}

async function cancelScheduledRemindersForAppointment(appointmentId) {
  try {
    const result = await prisma.reminderJob.updateMany({
      where: {
        appointmentId,
        status: 'scheduled'
      },
      data: {
        status: 'skipped',
        lastError: 'Appointment is no longer active'
      }
    });

    return { ok: true, cancelled: result.count };
  } catch (error) {
    if (isReminderTableMissing(error)) {
      return { ok: false, unsupported: true };
    }
    throw error;
  }
}

async function scheduleRefillReminderForAppointment(appointmentId) {
  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        doctor: { select: { fullName: true } },
        prescription: {
          select: {
            followUpAt: true,
            handoffCode: true
          }
        }
      }
    });

    if (!appointment || !appointment.prescription?.followUpAt) {
      return { ok: true, scheduled: 0, reason: 'follow_up_missing' };
    }

    if (!safeText(appointment.patient?.phone)) {
      return { ok: true, scheduled: 0, reason: 'patient_phone_missing' };
    }

    const now = Date.now();
    const followUpAtMs = new Date(appointment.prescription.followUpAt).getTime();
    if (Number.isNaN(followUpAtMs)) {
      return { ok: true, scheduled: 0, reason: 'follow_up_invalid' };
    }

    const sendAt = new Date(followUpAtMs - 3 * 24 * 60 * 60 * 1000);

    await prisma.reminderJob.deleteMany({
      where: {
        appointmentId,
        status: 'scheduled',
        templateKey: 'prescription_refill_3d'
      }
    });

    if (sendAt.getTime() <= now + 30 * 1000) {
      return { ok: true, scheduled: 0, reason: 'refill_window_passed' };
    }

    await prisma.reminderJob.create({
      data: {
        appointmentId,
        patientId: appointment.patientId,
        channel: 'sms',
        sendAt,
        templateKey: 'prescription_refill_3d',
        payload: buildRefillReminderPayload(appointment),
        status: 'scheduled'
      }
    });

    return { ok: true, scheduled: 1 };
  } catch (error) {
    if (isReminderTableMissing(error)) {
      return { ok: false, unsupported: true };
    }
    throw error;
  }
}

function messageForDispatch(job) {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : null;
  if (payload?.message) return String(payload.message);

  const patientName = safeText(job.patient?.fullName) || 'Patient';
  const doctorName = safeText(job.appointment?.doctor?.fullName) || 'Doctor';
  const timeLabel = `${new Date(job.appointment?.startAt || '').toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour12: true
  })} IST`;
  return `Namaste ${patientName}. Reminder: consultation with Dr. ${doctorName} at ${timeLabel}.`;
}

async function dispatchDueReminderJobs(options = {}) {
  const limit = Number(options.limit) > 0 ? Math.min(Number(options.limit), 80) : 25;
  const doctorId = safeText(options.doctorId) || null;

  try {
    const where = {
      status: 'scheduled',
      sendAt: { lte: new Date() },
      ...(doctorId ? { appointment: { doctorId } } : {})
    };

    const jobs = await prisma.reminderJob.findMany({
      where,
      include: {
        patient: { select: { fullName: true, phone: true } },
        appointment: {
          select: {
            id: true,
            startAt: true,
            doctor: { select: { fullName: true } }
          }
        }
      },
      orderBy: { sendAt: 'asc' },
      take: limit
    });

    let sent = 0;
    let failed = 0;

    for (const job of jobs) {
      const targetPhone = safeText(job.patient?.phone);
      if (!targetPhone) {
        await prisma.reminderJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            attempts: { increment: 1 },
            failedAt: new Date(),
            lastError: 'Missing phone number'
          }
        });
        failed += 1;
        continue;
      }

      const smsBody = messageForDispatch(job);
      // eslint-disable-next-line no-console
      console.log(`[ReminderDispatch] SMS -> ${targetPhone}: ${smsBody}`);

      await prisma.reminderJob.update({
        where: { id: job.id },
        data: {
          status: 'sent',
          attempts: { increment: 1 },
          sentAt: new Date(),
          failedAt: null,
          lastError: null
        }
      });

      sent += 1;
    }

    return {
      ok: true,
      processed: jobs.length,
      sent,
      failed,
      skipped: 0
    };
  } catch (error) {
    if (isReminderTableMissing(error)) {
      return { ok: false, unsupported: true };
    }
    throw error;
  }
}

module.exports = {
  isReminderTableMissing,
  scheduleRemindersForAppointment,
  scheduleRefillReminderForAppointment,
  cancelScheduledRemindersForAppointment,
  dispatchDueReminderJobs
};
