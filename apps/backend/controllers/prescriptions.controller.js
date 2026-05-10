const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { prisma } = require('../models/db');
const { upsertSchema } = require('../models/schemas/prescriptions.schemas');
const { scheduleRefillReminderForAppointment } = require('../services/reminder.service');

function formatIstDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return `${date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  })} IST`;
}

function formatIstDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
}

function parseItems(itemsText) {
  // One per line: name, dosage, frequency, duration, side effects
  const lines = String(itemsText)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const parts = line.split(',').map((p) => p.trim());
    return {
      name: parts[0] || line,
      dosage: parts[1] || '',
      frequency: parts[2] || '',
      duration: parts[3] || '',
      sideEffects: parts[4] || ''
    };
  });
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}

function parseStructuredItems(raw) {
  const names = toArray(raw.medicationName).map((v) => String(v || '').trim());
  const dosages = toArray(raw.dosage).map((v) => String(v || '').trim());
  const frequencies = toArray(raw.frequency).map((v) => String(v || '').trim());
  const durations = toArray(raw.duration).map((v) => String(v || '').trim());
  const sideEffects = toArray(raw.sideEffects).map((v) => String(v || '').trim());

  const maxLen = Math.max(names.length, dosages.length, frequencies.length, durations.length, sideEffects.length);
  const items = [];
  for (let i = 0; i < maxLen; i++) {
    const name = names[i] || '';
    const dosage = dosages[i] || '';
    const frequency = frequencies[i] || '';
    const duration = durations[i] || '';
    const possibleSideEffects = sideEffects[i] || '';
    if (!name && !dosage && !frequency && !duration && !possibleSideEffects) continue;
    items.push({ name: name || 'Medication', dosage, frequency, duration, sideEffects: possibleSideEffects });
  }
  return items;
}

function normalizeSideEffects(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const MEDICINE_REFERENCE_CATALOG = [
  {
    name: 'Paracetamol',
    genericName: 'Acetaminophen',
    uses: 'Fever and mild to moderate pain relief.',
    sideEffects: ['Nausea', 'Rash', 'Liver strain in high doses'],
    caution: 'Avoid exceeding the prescribed daily dose.'
  },
  {
    name: 'Ibuprofen',
    genericName: 'Ibuprofen',
    uses: 'Pain, inflammation, and fever management.',
    sideEffects: ['Stomach irritation', 'Heartburn', 'Dizziness'],
    caution: 'Take after food unless your doctor advised otherwise.'
  },
  {
    name: 'Amoxicillin',
    genericName: 'Amoxicillin',
    uses: 'Bacterial infection treatment.',
    sideEffects: ['Loose stools', 'Nausea', 'Mild skin rash'],
    caution: 'Complete the full antibiotic course.'
  },
  {
    name: 'Cetirizine',
    genericName: 'Cetirizine',
    uses: 'Allergy symptom control.',
    sideEffects: ['Sleepiness', 'Dry mouth', 'Headache'],
    caution: 'Use caution with driving if drowsy.'
  },
  {
    name: 'Pantoprazole',
    genericName: 'Pantoprazole',
    uses: 'Acidity and reflux symptom relief.',
    sideEffects: ['Headache', 'Loose stools', 'Abdominal discomfort'],
    caution: 'Usually taken before meals as advised by doctor.'
  },
  {
    name: 'Metformin',
    genericName: 'Metformin',
    uses: 'Blood sugar control in diabetes.',
    sideEffects: ['Nausea', 'Bloating', 'Loose stools'],
    caution: 'Take with meals to reduce stomach upset.'
  },
  {
    name: 'Amlodipine',
    genericName: 'Amlodipine',
    uses: 'Blood pressure control.',
    sideEffects: ['Ankle swelling', 'Headache', 'Flushing'],
    caution: 'Do not stop suddenly without medical advice.'
  }
];

function buildSearchText(entry) {
  return [entry.name, entry.genericName, entry.uses, entry.caution, ...(entry.sideEffects || []), entry.diagnosisHint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildBaseMedicineCatalog() {
  return MEDICINE_REFERENCE_CATALOG.map((entry) => ({
    ...entry,
    source: 'reference',
    inPatientHistory: false,
    diagnosisHint: '',
    lastPrescribedAt: null,
    searchText: buildSearchText(entry)
  }));
}

function mergeCatalogEntry(map, nextEntry) {
  const key = String(nextEntry?.name || '').trim().toLowerCase();
  if (!key) return;

  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      ...nextEntry,
      sideEffects: Array.from(new Set(normalizeSideEffects(nextEntry.sideEffects))),
      searchText: buildSearchText(nextEntry)
    });
    return;
  }

  existing.sideEffects = Array.from(new Set([...normalizeSideEffects(existing.sideEffects), ...normalizeSideEffects(nextEntry.sideEffects)]));
  existing.inPatientHistory = existing.inPatientHistory || Boolean(nextEntry.inPatientHistory);

  const hasReferenceSource = String(existing.source || '').includes('reference') || String(nextEntry.source || '').includes('reference');
  const hasHistorySource =
    existing.inPatientHistory ||
    String(existing.source || '').includes('history') ||
    Boolean(nextEntry.inPatientHistory) ||
    String(nextEntry.source || '').includes('history');

  if (hasReferenceSource && hasHistorySource) {
    existing.source = 'reference+history';
  } else if (hasReferenceSource) {
    existing.source = 'reference';
  } else {
    existing.source = 'history';
  }

  if (!existing.genericName && nextEntry.genericName) {
    existing.genericName = nextEntry.genericName;
  }
  if (!existing.uses && nextEntry.uses) {
    existing.uses = nextEntry.uses;
  }
  if (!existing.caution && nextEntry.caution) {
    existing.caution = nextEntry.caution;
  }
  if (!existing.diagnosisHint && nextEntry.diagnosisHint) {
    existing.diagnosisHint = nextEntry.diagnosisHint;
  }

  if (nextEntry.lastPrescribedAt) {
    if (!existing.lastPrescribedAt || new Date(nextEntry.lastPrescribedAt).getTime() > new Date(existing.lastPrescribedAt).getTime()) {
      existing.lastPrescribedAt = nextEntry.lastPrescribedAt;
    }
  }

  existing.searchText = buildSearchText(existing);
}

async function loadScopedPrescriptionHistory(user) {
  const where = { prescription: { isNot: null } };
  if (user.role === 'patient') {
    where.patientId = user.id;
  } else if (user.role === 'doctor') {
    where.doctorId = user.id;
  }

  return prisma.appointment.findMany({
    where,
    include: {
      doctor: { select: { fullName: true } },
      prescription: {
        select: {
          diagnosis: true,
          items: true,
          updatedAt: true
        }
      }
    },
    orderBy: { startAt: 'desc' },
    take: 120
  });
}

function buildHistoryCatalog(appointments) {
  const output = [];

  appointments.forEach((appointment) => {
    const diagnosis = String(appointment?.prescription?.diagnosis || '').trim();
    const items = Array.isArray(appointment?.prescription?.items) ? appointment.prescription.items : [];

    items.forEach((item) => {
      const name = String(item?.name || '').trim();
      if (!name) return;

      output.push({
        name,
        genericName: '',
        uses: diagnosis ? `Used previously for ${diagnosis}.` : 'Seen in your prescription history.',
        sideEffects: normalizeSideEffects(item?.sideEffects),
        caution: `Doctor note: ${appointment?.doctor?.fullName || 'Doctor'} advised following exact dosage and frequency.`,
        source: 'history',
        inPatientHistory: true,
        diagnosisHint: diagnosis,
        lastPrescribedAt: appointment.startAt || appointment?.prescription?.updatedAt || null
      });
    });
  });

  return output;
}

function searchCatalogEntries(entries, query, limit) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  const scored = entries
    .filter((entry) => entry.searchText.includes(needle))
    .map((entry) => {
      const name = String(entry.name || '').toLowerCase();
      let score = 0;
      if (name === needle) score += 10;
      else if (name.startsWith(needle)) score += 6;
      else score += 3;
      if (entry.inPatientHistory) score += 2;
      return { entry, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => {
      const sideEffects = Array.from(new Set(normalizeSideEffects(entry.sideEffects))).slice(0, 8);
      return {
        name: entry.name,
        genericName: entry.genericName,
        uses: entry.uses,
        sideEffects,
        caution: entry.caution,
        source: entry.source,
        inPatientHistory: entry.inPatientHistory,
        diagnosisHint: entry.diagnosisHint,
        lastPrescribedAt: entry.lastPrescribedAt
      };
    });

  return scored;
}

function parseHandoffFromNotes(notesValue) {
  const lines = String(notesValue || '')
    .split(/\r?\n/)
    .map((line) => line.trim());

  let pharmacyName = '';
  let pharmacyContact = '';
  const cleanNotes = [];

  lines.forEach((line) => {
    if (!line) return;
    if (line.startsWith('[PHARMACY] ')) {
      pharmacyName = line.replace('[PHARMACY] ', '').trim();
      return;
    }
    if (line.startsWith('[PHARMACY_CONTACT] ')) {
      pharmacyContact = line.replace('[PHARMACY_CONTACT] ', '').trim();
      return;
    }
    cleanNotes.push(line);
  });

  return {
    pharmacyName,
    pharmacyContact,
    cleanNotes: cleanNotes.join('\n').trim()
  };
}

function buildHandoffCode(appointmentId) {
  const prefix = String(appointmentId || '').split('-')[0] || 'NA';
  return `RX-${prefix.toUpperCase()}`;
}

function resolvePrescriptionHandoff(prescription, appointmentId) {
  const legacy = parseHandoffFromNotes(prescription?.notes || '');
  const hasStructured = Boolean(prescription?.pharmacyName || prescription?.pharmacyContact || prescription?.handoffCode);

  return {
    pharmacyName: (prescription?.pharmacyName || legacy.pharmacyName || '').trim(),
    pharmacyContact: (prescription?.pharmacyContact || legacy.pharmacyContact || '').trim(),
    cleanNotes: hasStructured ? String(prescription?.notes || '').trim() : legacy.cleanNotes,
    handoffCode: (prescription?.handoffCode || buildHandoffCode(appointmentId)).trim()
  };
}

async function buildQrBuffer(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const dataUrl = await QRCode.toDataURL(text, {
    margin: 1,
    width: 220
  });
  const base64 = String(dataUrl).split(',')[1] || '';
  if (!base64) return null;
  return Buffer.from(base64, 'base64');
}

async function ensureAppointmentAccess(appointmentId, user) {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: { select: { id: true, fullName: true } },
      patient: { select: { id: true, fullName: true, language: true } },
      familyMember: { select: { id: true, fullName: true } },
      prescription: true
    }
  });
  if (!appt) return null;
  if (user.role === 'admin') return appt;
  if (user.id !== appt.patientId && user.id !== appt.doctorId) return null;
  return appt;
}

const prescriptionsController = {
  searchMedicineCatalog: async (req, res, next) => {
    try {
      const query = String(req.query.q || '').trim();
      const limitRaw = Number(req.query.limit || 8);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(25, Math.floor(limitRaw))) : 8;

      if (query.length < 2) {
        return res.status(400).json({
          ok: false,
          error: 'Enter at least 2 characters to search medicines.'
        });
      }

      const [historyAppointments] = await Promise.all([loadScopedPrescriptionHistory(req.user)]);

      const entryMap = new Map();
      buildBaseMedicineCatalog().forEach((entry) => mergeCatalogEntry(entryMap, entry));
      buildHistoryCatalog(historyAppointments).forEach((entry) => mergeCatalogEntry(entryMap, entry));

      const results = searchCatalogEntries(Array.from(entryMap.values()), query, limit);
      return res.json({
        ok: true,
        query,
        results,
        count: results.length
      });
    } catch (e) {
      return next(e);
    }
  },

  viewPrescription: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Not found' });

      const handoff = resolvePrescriptionHandoff(appt.prescription, appt.id);
      if (appt.prescription) {
        appt.prescription.notes = handoff.cleanNotes;
      }

      return res.render('prescription', {
        user: req.user,
        appointment: appt,
        handoff,
        handoffCode: handoff.handoffCode,
        error: null,
        message: null
      });
    } catch (e) {
      return next(e);
    }
  },

  upsertPrescription: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt) return res.status(404).render('dashboard', { user: req.user, message: 'Not found' });
      if (req.user.role !== 'doctor' || req.user.id !== appt.doctorId) {
        return res.status(403).render('dashboard', { user: req.user, message: 'Only the assigned doctor can write this.' });
      }
      if (appt.status !== 'booked') {
        return res.status(409).render('prescription', {
          user: req.user,
          appointment: appt,
          error: 'Appointment is closed. Prescription cannot be edited.',
          message: null
        });
      }

      const parsed = upsertSchema.safeParse(req.body);
      if (!parsed.success) {
        const handoff = resolvePrescriptionHandoff(appt.prescription, appt.id);
        return res.status(400).render('prescription', {
          user: req.user,
          appointment: appt,
          handoff,
          handoffCode: handoff.handoffCode,
          error: 'Invalid inputs (diagnosis + at least one medication line required).',
          message: null
        });
      }

      let items = parseStructuredItems(parsed.data);
      if (items.length === 0 && parsed.data.itemsText) {
        items = parseItems(parsed.data.itemsText);
      }
      if (items.length === 0) {
        const handoff = resolvePrescriptionHandoff(appt.prescription, appt.id);
        return res.status(400).render('prescription', {
          user: req.user,
          appointment: appt,
          handoff,
          handoffCode: handoff.handoffCode,
          error: 'Add at least one medication with name/dosage/frequency/duration.',
          message: null
        });
      }
      const handoffCode = buildHandoffCode(appointmentId);

      await prisma.prescription.upsert({
        where: { appointmentId },
        update: {
          diagnosis: parsed.data.diagnosis,
          items,
          instructions: parsed.data.instructions || null,
          followUpAt: parsed.data.followUpAt ? new Date(parsed.data.followUpAt) : null,
          notes: parsed.data.notes || null,
          pharmacyName: parsed.data.pharmacyName || null,
          pharmacyContact: parsed.data.pharmacyContact || null,
          handoffCode
        },
        create: {
          appointmentId,
          diagnosis: parsed.data.diagnosis,
          items,
          instructions: parsed.data.instructions || null,
          followUpAt: parsed.data.followUpAt ? new Date(parsed.data.followUpAt) : null,
          notes: parsed.data.notes || null,
          pharmacyName: parsed.data.pharmacyName || null,
          pharmacyContact: parsed.data.pharmacyContact || null,
          handoffCode
        }
      });

      await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'completed' } });
      const refillReminder = await scheduleRefillReminderForAppointment(appointmentId).catch(() => null);

      const refreshed = await ensureAppointmentAccess(appointmentId, req.user);
      const handoff = resolvePrescriptionHandoff(refreshed?.prescription, appointmentId);
      if (refreshed && refreshed.prescription) {
        refreshed.prescription.notes = handoff.cleanNotes;
      }

      const saveMessage = refillReminder?.scheduled
        ? 'Saved. Refill reminder is scheduled 3 days before follow-up.'
        : 'Saved.';

      return res.render('prescription', {
        user: req.user,
        appointment: refreshed,
        handoff,
        handoffCode: handoff.handoffCode,
        error: null,
        message: saveMessage
      });
    } catch (e) {
      return next(e);
    }
  },

  downloadPdf: async (req, res, next) => {
    try {
      const appointmentId = req.params.appointmentId;
      const appt = await ensureAppointmentAccess(appointmentId, req.user);
      if (!appt || !appt.prescription) return res.status(404).render('dashboard', { user: req.user, message: 'Prescription not found' });

      const forceDownload = req.query.download === '1';
      const disposition = forceDownload ? 'attachment' : 'inline';

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${disposition}; filename="prescription-${appointmentId}.pdf"`);

      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      doc.fontSize(18).text('Prescription', { align: 'center' });
      doc.moveDown();

      doc.fontSize(12);
      doc.text(`Doctor: ${appt.doctor.fullName}`);
      doc.text(`Patient: ${appt.patient.fullName}`);
      doc.text(`Appointment: ${formatIstDateTime(appt.startAt)}`);
      doc.moveDown();

      doc.fontSize(13).text('Diagnosis:', { underline: true });
      doc.fontSize(12).text(appt.prescription.diagnosis);
      doc.moveDown();

      doc.fontSize(13).text('Medications:', { underline: true });
      const items = Array.isArray(appt.prescription.items) ? appt.prescription.items : [];
      items.forEach((item, idx) => {
        doc.fontSize(12).text(`${idx + 1}. ${item.name || ''}`);
        const parts = [item.dosage, item.frequency, item.duration].filter(Boolean).join(' | ');
        if (parts) doc.fontSize(10).text(parts, { indent: 14 });
        if (item.sideEffects) {
          doc.fontSize(10).text(`Possible side effects: ${item.sideEffects}`, { indent: 14 });
        }
      });
      doc.moveDown();

      if (appt.prescription.instructions) {
        doc.fontSize(13).text('Instructions:', { underline: true });
        doc.fontSize(12).text(appt.prescription.instructions);
        doc.moveDown();
      }

      if (appt.prescription.followUpAt) {
        doc.fontSize(12).text(`Follow-up: ${formatIstDate(appt.prescription.followUpAt)}`);
      }

      const handoff = resolvePrescriptionHandoff(appt.prescription, appt.id);
      doc.moveDown();
      doc.fontSize(12).text(`Handoff code: ${handoff.handoffCode}`);

      const qrBuffer = await buildQrBuffer(handoff.handoffCode).catch(() => null);
      if (qrBuffer) {
        doc.moveDown(0.5);
        doc.fontSize(11).text('Pharmacy handoff QR (scan at counter):');
        doc.image(qrBuffer, doc.x, doc.y + 6, { fit: [120, 120] });
        doc.moveDown(5);
      }

      if (handoff.pharmacyName) {
        doc.fontSize(12).text(`Preferred pharmacy: ${handoff.pharmacyName}`);
      }
      if (handoff.pharmacyContact) {
        doc.fontSize(12).text(`Pharmacy contact: ${handoff.pharmacyContact}`);
      }

      if (handoff.cleanNotes) {
        doc.moveDown();
        doc.fontSize(10).text(`Notes: ${handoff.cleanNotes}`);
      }

      doc.end();
    } catch (e) {
      return next(e);
    }
  }
};

module.exports = { prescriptionsController };
