const fs = require('fs');
const { prisma } = require('../models/db');
const { getLocalFilePath, getReadSasUrl } = require('../services/storage.service');
const {
  aiGenerate,
  getAiModel,
  getAiProviderInfo,
  getOllamaBaseUrl,
  getOllamaModel,
  isAiConfigured,
  isOllamaConfigured,
  tryParseJson
} = require('../services/ollama.service');
const {
  draftNoteSchema,
  visitSummarySchema,
  simplifyMedicationSchema,
  triageAssistSchema,
  reminderTextSchema,
  referralSummarySchema,
  documentAssistSchema,
  helperGuidanceSchema,
  translateChatSchema
} = require('../models/schemas/ai.schemas');

const AI_SYSTEM_PROMPT = [
  'You are a careful telemedicine copilot running in a clinical workflow.',
  'Return concise JSON only, never markdown, never code fences.',
  'Never claim a definitive diagnosis from limited data.',
  'If severe symptoms are mentioned, clearly recommend urgent in-person or emergency care.',
  'Do not include personally identifying details beyond what is necessary for the requested draft.',
  'All outputs are drafts for clinician/patient review, not autonomous decisions.'
].join(' ');

function formatIstDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown time';
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

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d[\d\s-]{8,}\d)\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '[REDACTED_NATIONAL_ID]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[REDACTED_UUID]');
}

function redactSensitiveData(value, depth = 0) {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return redactSensitiveText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, depth + 1));
  if (typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([k, v]) => {
      next[k] = redactSensitiveData(v, depth + 1);
    });
    return next;
  }
  return value;
}

function normalizeLanguageKey(language) {
  const key = String(language || '').trim().toLowerCase();
  if (!key) return 'english';
  if (key === 'hi' || key.includes('hindi')) return 'hindi';
  if (key === 'en' || key.includes('english')) return 'english';
  return 'english';
}

function getVisitSummaryTemplate(language, personName) {
  const lang = normalizeLanguageKey(language);
  if (lang === 'hindi') {
    return {
      summary: `${personName} ke liye follow-up summary. Lakshan, dawai yojana aur warning signs par dhyan rakhein.`,
      keyPoints: [
        'Paramarsh ka mode aur samay verify karein.',
        'Nirdharit dawai schedule ka paalan karein.',
        'Lakshan badhne par turant doctor se sampark karein.'
      ],
      nextSteps: ['Dawai samay par lein.', 'Agle follow-up ke liye tayari rakhein.', 'Emergency signs par turant care lein.'],
      warningSigns: ['Saas lene mein dikkat', 'Tez seene ka dard', 'Lambi tez bukhar']
    };
  }

  return {
    summary: `This is a follow-up summary for ${personName}. Review symptoms, medication plan, and warning signs with the care team.`,
    keyPoints: ['Consultation mode and timing were reviewed.', 'Medication schedule should be followed exactly.', 'Escalate quickly if symptoms worsen.'],
    nextSteps: ['Follow the prescribed plan.', 'Contact the clinic if symptoms worsen.', 'Attend follow-up appointment if scheduled.'],
    warningSigns: ['Breathing difficulty', 'Severe chest pain', 'Persistent high fever']
  };
}

function getReminderTemplate(language, patientName, doctorName, startLabel) {
  const lang = normalizeLanguageKey(language);
  if (lang === 'hindi') {
    return {
      message: `Namaste ${patientName}, Dr. ${doctorName} ke saath aapka telemedicine visit ${startLabel} par hai. Kripya phone ready rakhein.`,
      alternatives: [
        `${patientName}, appointment ${startLabel} par shuru hogi.`,
        `Yaad-dihani: Dr. ${doctorName} ke saath consult ${startLabel}.`
      ],
      scheduleHint: 'Yatha-sambhav 24 ghante pehle aur 30 minute pehle reminder bhejein.'
    };
  }

  return {
    message: `Reminder: ${patientName}, your telemedicine visit with Dr. ${doctorName} is at ${startLabel}. Reply if you need help joining.`,
    alternatives: [
      `${patientName}, your appointment starts at ${startLabel}. Please keep your phone ready.`,
      `Care reminder: visit with Dr. ${doctorName} at ${startLabel}. Reach out if support is needed.`
    ],
    scheduleHint: 'Send one reminder 24h before and one 30m before appointment when possible.'
  };
}

function toCleanString(value, max = 2000) {
  return redactSensitiveText(String(value || '').trim().slice(0, max));
}

function normalizePhone(value) {
  return String(value || '')
    .replace(/[^0-9]/g, '')
    .trim();
}

function buildHelperPhoneWhere(phone) {
  const raw = String(phone || '').trim();
  const normalized = normalizePhone(phone);
  const tail10 = normalized.length >= 10 ? normalized.slice(-10) : '';

  const where = [];
  if (raw) where.push({ helperPhone: raw });
  if (normalized) where.push({ helperPhone: normalized });
  if (tail10) where.push({ helperPhone: { endsWith: tail10 } });
  return where;
}

function uniqueStrings(list, max = 8) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const value = toCleanString(item, 240);
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function safeLanguage(value, fallback = 'English') {
  const v = toCleanString(value, 40);
  return v || fallback;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? age : null;
}

function formatUrgencyLabel(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'within_7_days') return 'Within 7 days';
  if (raw === 'urgent') return 'Urgent';
  if (raw === 'emergency') return 'Emergency';
  if (raw === 'routine') return 'Routine';
  return 'Within 7 days';
}

function asJsonObject(candidate) {
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
}

function containsAnyKeyword(text, terms) {
  const normalized = String(text || '').toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function basicUrgencyScore(symptoms) {
  const text = String(symptoms || '').toLowerCase();
  if (!text) return 0;

  const emergencyTerms = ['chest pain', 'unconscious', 'seizure', 'stroke', 'severe bleeding', 'cannot breathe'];
  const urgentTerms = ['high fever', 'shortness of breath', 'persistent vomiting', 'dehydration', 'severe pain'];
  const moderateTerms = ['fatigue', 'headache', 'rash', 'cough', 'sore throat'];

  let score = 0;
  emergencyTerms.forEach((term) => {
    if (text.includes(term)) score += 5;
  });
  urgentTerms.forEach((term) => {
    if (text.includes(term)) score += 2;
  });
  moderateTerms.forEach((term) => {
    if (text.includes(term)) score += 1;
  });
  return score;
}

async function getHelperDelegationScope(user) {
  const phoneWhere = buildHelperPhoneWhere(user.phone);
  if (!phoneWhere.length) {
    return {
      appointmentPatientIds: new Set(),
      recordsPatientIds: new Set(),
      appointmentIds: new Set(),
      linkedPatientIds: new Set()
    };
  }

  const helperLinks = await prisma.careSupportLink.findMany({
    where: {
      isActive: true,
      OR: phoneWhere
    },
    select: { id: true }
  });

  if (!helperLinks.length) {
    return {
      appointmentPatientIds: new Set(),
      recordsPatientIds: new Set(),
      appointmentIds: new Set(),
      linkedPatientIds: new Set()
    };
  }

  const helperIds = helperLinks.map((item) => item.id);
  const consentRows = await prisma.consentAudit.findMany({
    where: {
      helperId: { in: helperIds },
      isActive: true,
      scope: { in: ['all', 'appointment', 'records'] }
    },
    select: {
      patientId: true,
      appointmentId: true,
      scope: true
    }
  });

  const appointmentPatientIds = new Set();
  const recordsPatientIds = new Set();
  const appointmentIds = new Set();
  const linkedPatientIds = new Set();

  consentRows.forEach((row) => {
    if (row.patientId) linkedPatientIds.add(row.patientId);

    if (row.scope === 'all') {
      if (row.patientId) {
        appointmentPatientIds.add(row.patientId);
        recordsPatientIds.add(row.patientId);
      }
      return;
    }

    if (row.scope === 'appointment') {
      if (row.appointmentId) {
        appointmentIds.add(row.appointmentId);
      } else if (row.patientId) {
        appointmentPatientIds.add(row.patientId);
      }
      return;
    }

    if (row.scope === 'records' && row.patientId) {
      recordsPatientIds.add(row.patientId);
    }
  });

  return {
    appointmentPatientIds,
    recordsPatientIds,
    appointmentIds,
    linkedPatientIds
  };
}

async function loadAppointmentWithAccess(appointmentId, user) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      doctor: { select: { id: true, fullName: true, language: true } },
      patient: {
        select: {
          id: true,
          fullName: true,
          gender: true,
          dateOfBirth: true,
          language: true,
          phone: true,
          patientProfile: { select: { chronicConditions: true, basicHealthInfo: true } }
        }
      },
      familyMember: { select: { id: true, fullName: true, relationToPatient: true, chronicConditions: true, basicHealthInfo: true } },
      prescription: true,
      documents: { select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true } },
      callSession: { select: { id: true, status: true, startedAt: true, endedAt: true } }
    }
  });

  if (!appointment) return null;
  if (user.role === 'admin') return appointment;
  if (user.id === appointment.patientId || user.id === appointment.doctorId) return appointment;

  if (user.role === 'help_worker') {
    const scope = await getHelperDelegationScope(user);
    const canByPatient = scope.appointmentPatientIds.has(appointment.patientId);
    const canByAppointment = scope.appointmentIds.has(appointment.id);
    if (canByPatient || canByAppointment) return appointment;
  }

  return null;
}

async function loadDocumentWithAccess(documentId, user) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      owner: { select: { id: true, fullName: true } },
      appointment: { select: { id: true, patientId: true, doctorId: true, startAt: true } }
    }
  });

  if (!document) return null;
  if (user.role === 'admin') return document;
  if (document.ownerId === user.id) return document;

  if (document.appointmentId) {
    const appointment = await loadAppointmentWithAccess(document.appointmentId, user);
    if (appointment) return document;
  }

  if (user.role === 'doctor') {
    const seenContext = await prisma.appointment.findFirst({
      where: {
        doctorId: user.id,
        patientId: document.ownerId,
        familyMemberId: document.familyMemberId || null
      },
      select: { id: true }
    });

    if (seenContext) return document;
  }

  if (user.role === 'help_worker') {
    const scope = await getHelperDelegationScope(user);
    const canByRecords = scope.recordsPatientIds.has(document.ownerId);
    const canByAppointment = document.appointmentId && scope.appointmentIds.has(document.appointmentId);
    if (canByRecords || canByAppointment) return document;
  }

  return null;
}

function isLikelyTextDocument(document) {
  const contentType = String(document?.contentType || '').toLowerCase();
  const fileName = String(document?.fileName || '').toLowerCase();

  if (contentType.startsWith('text/')) return true;
  if (contentType.includes('json') || contentType.includes('xml') || contentType.includes('csv')) return true;
  return fileName.endsWith('.txt') || fileName.endsWith('.md') || fileName.endsWith('.json') || fileName.endsWith('.csv') || fileName.endsWith('.xml');
}

async function readDocumentText(document) {
  if (!isLikelyTextDocument(document)) return '';

  const localPath = getLocalFilePath(document.blobName);
  if (fs.existsSync(localPath)) {
    const localText = await fs.promises.readFile(localPath, 'utf8');
    return localText;
  }

  const sasUrl = getReadSasUrl({ blobName: document.blobName, expiresInMinutes: 10 });
  if (String(sasUrl || '').startsWith('/documents/local/')) {
    const pathFromBlob = getLocalFilePath(document.blobName);
    if (fs.existsSync(pathFromBlob)) {
      const text = await fs.promises.readFile(pathFromBlob, 'utf8');
      return text;
    }
    return '';
  }

  const downloadRes = await fetch(sasUrl);
  if (!downloadRes.ok) {
    return '';
  }

  const raw = Buffer.from(await downloadRes.arrayBuffer()).toString('utf8');
  return raw;
}

function normalizeExtractedText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .trim()
    .slice(0, 8000);
}

function selectSourceSnippets(text, question) {
  const normalizedText = normalizeExtractedText(text);
  if (!normalizedText) return [];

  const keywords = [...new Set(String(question || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4))];

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 16);

  if (!lines.length) return [];

  const scored = lines.map((line, idx) => {
    const lc = line.toLowerCase();
    let score = 0;
    keywords.forEach((word) => {
      if (lc.includes(word)) score += 2;
    });
    if (/[0-9]/.test(line)) score += 1;
    return { idx, score, line };
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((row) => row.line.slice(0, 220));

  if (top.every((line) => !line)) {
    return lines.slice(0, 3).map((line) => line.slice(0, 220));
  }

  return top;
}

async function runJsonTask({ taskPrompt, fallback, maxTokens = 900 }) {
  const safePrompt = redactSensitiveText(taskPrompt);

  if (!isAiConfigured()) {
    return {
      data: redactSensitiveData(fallback),
      fallbackUsed: true,
      model: 'fallback'
    };
  }

  try {
    const text = await aiGenerate({
      systemPrompt: AI_SYSTEM_PROMPT,
      userPrompt: safePrompt,
      temperature: 0.2,
      maxTokens
    });

    const parsed = tryParseJson(text);
    if (!parsed || typeof parsed !== 'object') {
      return {
        data: redactSensitiveData(fallback),
        fallbackUsed: true,
        model: getAiModel(),
        raw: text
      };
    }

    return {
      data: redactSensitiveData(parsed),
      fallbackUsed: false,
      model: getAiModel(),
      raw: text
    };
  } catch (_err) {
    return {
      data: redactSensitiveData(fallback),
      fallbackUsed: true,
      model: 'fallback'
    };
  }
}

function normalizeDraftNoteResult(result) {
  const payload = asJsonObject(result);
  return {
    subjective: toCleanString(payload.subjective, 1200),
    objective: toCleanString(payload.objective, 1000),
    assessment: toCleanString(payload.assessment, 1000),
    plan: toCleanString(payload.plan, 1200),
    followUpQuestions: uniqueStrings(payload.followUpQuestions, 8),
    riskFlags: uniqueStrings(payload.riskFlags, 6),
    safetyNote: toCleanString(payload.safetyNote || 'Doctor must review and edit before saving to patient records.', 220)
  };
}

function normalizeVisitSummaryResult(result) {
  const payload = asJsonObject(result);
  return {
    summary: toCleanString(payload.summary, 1400),
    keyPoints: uniqueStrings(payload.keyPoints, 7),
    nextSteps: uniqueStrings(payload.nextSteps, 7),
    warningSigns: uniqueStrings(payload.warningSigns, 6)
  };
}

function normalizeMedicationResult(result) {
  const payload = asJsonObject(result);
  const rawDailyPlan = Array.isArray(payload.dailyPlan) ? payload.dailyPlan : [];
  return {
    overview: toCleanString(payload.overview, 1200),
    dailyPlan: rawDailyPlan
      .slice(0, 6)
      .map((entry) => asJsonObject(entry))
      .map((entry) => ({
        time: toCleanString(entry.time, 80),
        whatToTake: toCleanString(entry.whatToTake, 180),
        tips: toCleanString(entry.tips, 220)
      }))
      .filter((entry) => entry.time || entry.whatToTake || entry.tips),
    dosAndDonts: uniqueStrings(payload.dosAndDonts, 8),
    seekHelpIf: uniqueStrings(payload.seekHelpIf, 6)
  };
}

function normalizeTriageResult(result) {
  const payload = asJsonObject(result);
  const urgency = toCleanString(payload.urgencyLevel || payload.urgency, 40).toLowerCase();
  const allowedUrgencies = ['self-care', 'routine', 'urgent', 'emergency'];
  return {
    urgencyLevel: allowedUrgencies.includes(urgency) ? urgency : 'routine',
    recommendedAction: toCleanString(payload.recommendedAction, 500),
    rationale: toCleanString(payload.rationale, 700),
    immediateSteps: uniqueStrings(payload.immediateSteps, 6),
    questionsToAsk: uniqueStrings(payload.questionsToAsk, 6),
    dangerSigns: uniqueStrings(payload.dangerSigns, 6)
  };
}

function normalizeReminderResult(result) {
  const payload = asJsonObject(result);
  return {
    message: toCleanString(payload.message, 420),
    alternatives: uniqueStrings(payload.alternatives, 3),
    scheduleHint: toCleanString(payload.scheduleHint, 180)
  };
}

function normalizeReferralSummaryResult(result) {
  const payload = asJsonObject(result);
  return {
    summaryParagraph: toCleanString(payload.summaryParagraph || payload.summary, 2200),
    urgency: formatUrgencyLabel(payload.urgency),
    referralChecklist: uniqueStrings(payload.referralChecklist, 6)
  };
}

function normalizeDocumentResult(result) {
  const payload = asJsonObject(result);
  const snippets = Array.isArray(payload.sourceSnippets) ? payload.sourceSnippets : [];

  return {
    answer: toCleanString(payload.answer, 1400),
    sourceSnippets: snippets
      .slice(0, 4)
      .map((entry) => asJsonObject(entry))
      .map((entry) => ({
        quote: toCleanString(entry.quote, 260),
        why: toCleanString(entry.why, 180)
      }))
      .filter((entry) => entry.quote),
    followUps: uniqueStrings(payload.followUps, 4)
  };
}

function normalizeGuidanceResult(result) {
  const payload = asJsonObject(result);
  const cards = Array.isArray(payload.cards) ? payload.cards : [];

  return {
    cards: cards
      .slice(0, 4)
      .map((entry) => asJsonObject(entry))
      .map((entry) => ({
        title: toCleanString(entry.title, 80),
        whyItMatters: toCleanString(entry.whyItMatters, 220),
        checklist: uniqueStrings(entry.checklist, 5)
      }))
      .filter((entry) => entry.title || entry.whyItMatters || entry.checklist.length),
    escalationSigns: uniqueStrings(payload.escalationSigns, 6),
    handoffNote: toCleanString(payload.handoffNote, 300)
  };
}

function normalizeTranslateResult(result, text) {
  const payload = asJsonObject(result);
  return {
    translatedText: toCleanString(payload.translatedText, 2200) || toCleanString(text, 2000),
    detectedSourceLanguage: toCleanString(payload.detectedSourceLanguage || payload.sourceLanguage || 'unknown', 40),
    notes: uniqueStrings(payload.notes, 3)
  };
}

function requireRole(user, roles) {
  return roles.includes(user.role);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function normalizeAudience(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'doctor' || v === 'caregiver') return v;
  return 'patient';
}

function normalizeAsyncReplyResult(result) {
  const payload = asJsonObject(result);
  return {
    suggestedReply: toCleanString(payload.suggestedReply || payload.message, 1800),
    reasoningHighlights: uniqueStrings(payload.reasoningHighlights, 6)
  };
}

const aiController = {
  getContext: async (req, res, next) => {
    try {
      let appointmentWhere;
      let documentsWhere;
      let delegatedPatients = [];

      if (req.user.role === 'patient') {
        appointmentWhere = { patientId: req.user.id };
        documentsWhere = { ownerId: req.user.id };
        delegatedPatients = [{ id: req.user.id, fullName: req.user.fullName }];
      } else if (req.user.role === 'doctor') {
        appointmentWhere = { doctorId: req.user.id };
        documentsWhere = {
          OR: [
            { appointment: { doctorId: req.user.id } },
            { ownerId: req.user.id }
          ]
        };
      } else if (req.user.role === 'help_worker') {
        const scope = await getHelperDelegationScope(req.user);
        const appointmentClauses = [];
        if (scope.appointmentPatientIds.size) {
          appointmentClauses.push({ patientId: { in: [...scope.appointmentPatientIds] } });
        }
        if (scope.appointmentIds.size) {
          appointmentClauses.push({ id: { in: [...scope.appointmentIds] } });
        }
        appointmentWhere = appointmentClauses.length ? { OR: appointmentClauses } : { id: '__none__' };

        const documentClauses = [];
        if (scope.recordsPatientIds.size) {
          documentClauses.push({ ownerId: { in: [...scope.recordsPatientIds] } });
        }
        if (scope.appointmentIds.size) {
          documentClauses.push({ appointmentId: { in: [...scope.appointmentIds] } });
        }
        documentsWhere = documentClauses.length ? { OR: documentClauses } : { id: '__none__' };

        if (scope.linkedPatientIds.size) {
          delegatedPatients = await prisma.user.findMany({
            where: { id: { in: [...scope.linkedPatientIds] } },
            select: { id: true, fullName: true },
            orderBy: { fullName: 'asc' }
          });
        }
      } else {
        appointmentWhere = {};
        documentsWhere = {};
      }

      const [appointments, documents] = await Promise.all([
        prisma.appointment.findMany({
          where: appointmentWhere,
          include: {
            doctor: { select: { id: true, fullName: true, language: true } },
            patient: { select: { id: true, fullName: true, language: true } },
            familyMember: { select: { id: true, fullName: true } },
            prescription: { select: { id: true } }
          },
          orderBy: { startAt: 'desc' },
          take: 120
        }),
        prisma.document.findMany({
          where: documentsWhere,
          include: {
            owner: { select: { id: true, fullName: true } },
            appointment: { select: { id: true, startAt: true } }
          },
          orderBy: { createdAt: 'desc' },
          take: 120
        })
      ]);

      return res.json({
        ok: true,
        ai: getAiProviderInfo(),
        ollama: {
          configured: isOllamaConfigured(),
          model: getOllamaModel(),
          baseUrl: getOllamaBaseUrl()
        },
        appointments,
        documents,
        delegatedPatients
      });
    } catch (error) {
      return next(error);
    }
  },

  draftDoctorNote: async (req, res, next) => {
    try {
      if (!requireRole(req.user, ['doctor', 'admin'])) {
        return res.status(403).json({ error: 'Only doctors or admins can draft doctor notes.' });
      }

      const parsed = draftNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid draft note request.' });
      }

      const appointment = await loadAppointmentWithAccess(parsed.data.appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      const personName = appointment.familyMember?.fullName || appointment.patient.fullName;
      const focus = toCleanString(parsed.data.focus, 400);

      const fallback = normalizeDraftNoteResult({
        subjective: appointment.problemDescription || 'Patient-reported symptoms are not available yet.',
        objective: 'Limited objective data captured in telemedicine context. Verify vitals in-session.',
        assessment: 'Preliminary telemedicine impression only. Confirm clinically before finalizing diagnosis.',
        plan: 'Review current symptoms, confirm medication history, and decide on follow-up or in-person escalation.',
        followUpQuestions: ['When did symptoms begin?', 'Any worsening signs since last visit?', 'Any medication side effects?'],
        riskFlags: ['Escalate urgently for breathing trouble, chest pain, confusion, or uncontrolled bleeding.'],
        safetyNote: 'Draft only. Doctor must review, edit, and sign before sharing.'
      });

      const taskPrompt = [
        'TASK: Draft a concise SOAP-style doctor note as JSON.',
        'Return JSON with keys: subjective, objective, assessment, plan, followUpQuestions, riskFlags, safetyNote.',
        `Patient Context: ${personName}`,
        `Appointment Mode: ${appointment.mode}`,
        `Symptoms: ${toCleanString(appointment.problemDescription, 1800) || 'None provided'}`,
        `Current Medicines: ${toCleanString(appointment.medicationsText, 1000) || 'None provided'}`,
        `Existing Diagnosis: ${toCleanString(appointment.prescription?.diagnosis, 800) || 'Not yet documented'}`,
        `Focus: ${focus || 'General follow-up note'}`,
        'Keep language professional and clinically cautious.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback });
      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeDraftNoteResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  generateVisitSummary: async (req, res, next) => {
    try {
      const parsed = visitSummarySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid visit summary request.' });
      }

      const appointment = await loadAppointmentWithAccess(parsed.data.appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      const audience = normalizeAudience(parsed.data.audience);
      const language = safeLanguage(parsed.data.language || req.user.language || appointment.patient.language || 'English');
      const personName = appointment.familyMember?.fullName || appointment.patient.fullName;

      const fallback = normalizeVisitSummaryResult({
        ...getVisitSummaryTemplate(language, personName),
        keyPoints: [
          `Consultation mode: ${appointment.mode}`,
          `Diagnosis: ${appointment.prescription?.diagnosis || 'Pending diagnosis'}`,
          `Current symptoms noted: ${toCleanString(appointment.problemDescription, 180) || 'Not provided'}`
        ]
      });

      const taskPrompt = [
        'TASK: Produce a patient-safe visit summary JSON.',
        'Return JSON with keys: summary, keyPoints, nextSteps, warningSigns.',
        `Audience: ${audience}`,
        `Language: ${language}`,
        `Patient: ${personName}`,
        `Doctor: ${appointment.doctor.fullName}`,
        `Symptoms: ${toCleanString(appointment.problemDescription, 1600) || 'Not provided'}`,
        `Medication list text: ${toCleanString(appointment.medicationsText, 1000) || 'Not provided'}`,
        `Diagnosis: ${toCleanString(appointment.prescription?.diagnosis, 1000) || 'Pending'}`,
        `Prescription instructions: ${toCleanString(appointment.prescription?.instructions, 1200) || 'Not available'}`,
        'Write clear, low-jargon points and include escalation warning signs.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeVisitSummaryResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  simplifyMedication: async (req, res, next) => {
    try {
      const parsed = simplifyMedicationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid medication simplification request.' });
      }

      const appointment = await loadAppointmentWithAccess(parsed.data.appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      if (!appointment.prescription) {
        return res.status(409).json({ error: 'No prescription exists for this appointment yet.' });
      }

      const language = safeLanguage(parsed.data.language || req.user.language || appointment.patient.language || 'English');
      const readingLevel = parsed.data.readingLevel || 'easy';

      const items = Array.isArray(appointment.prescription.items) ? appointment.prescription.items : [];
      const fallbackDailyPlan = items.slice(0, 6).map((item, idx) => ({
        time: `Dose ${idx + 1}`,
        whatToTake: `${toCleanString(item.name, 80) || 'Medication'} - ${toCleanString(item.dosage, 60) || 'As prescribed'}`,
        tips: `${toCleanString(item.frequency, 80) || 'Follow doctor frequency'}${item.duration ? ` for ${toCleanString(item.duration, 40)}` : ''}`
      }));

      const fallback = normalizeMedicationResult({
        overview: `Use this medicine plan in ${language}. Confirm exact dosage with your doctor before changes.`,
        dailyPlan: fallbackDailyPlan,
        dosAndDonts: [
          'Take medicines at consistent times each day.',
          'Do not stop medication early without doctor advice.',
          'Share side effects immediately with your care team.'
        ],
        seekHelpIf: ['Severe allergy signs', 'Breathing difficulty', 'Severe vomiting or confusion']
      });

      const taskPrompt = [
        'TASK: Simplify medication instructions into plain language JSON.',
        'Return JSON with keys: overview, dailyPlan, dosAndDonts, seekHelpIf.',
        'dailyPlan must be an array of objects with keys: time, whatToTake, tips.',
        `Language: ${language}`,
        `Reading level: ${readingLevel}`,
        `Diagnosis: ${toCleanString(appointment.prescription.diagnosis, 1000)}`,
        `Raw medication items JSON: ${JSON.stringify(items).slice(0, 2500)}`,
        `Doctor instructions: ${toCleanString(appointment.prescription.instructions, 1200) || 'None provided'}`,
        'Avoid changing medical intent. Keep wording practical and safe.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeMedicationResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  runTriageAssistant: async (req, res, next) => {
    try {
      const parsed = triageAssistSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid triage request.' });
      }

      const patientId = parsed.data.patientId || null;
      if (patientId && req.user.role === 'patient' && patientId !== req.user.id) {
        return res.status(403).json({ error: 'Patients can run triage only for their own context.' });
      }

      let patientContext = null;
      if (patientId) {
        if (req.user.role === 'help_worker') {
          const scope = await getHelperDelegationScope(req.user);
          if (!scope.recordsPatientIds.has(patientId) && !scope.appointmentPatientIds.has(patientId) && !scope.linkedPatientIds.has(patientId)) {
            return res.status(403).json({ error: 'No active delegated consent for this patient.' });
          }
        }

        if (req.user.role === 'doctor') {
          const hasRelation = await prisma.appointment.findFirst({
            where: {
              doctorId: req.user.id,
              patientId
            },
            select: { id: true }
          });
          if (!hasRelation) {
            return res.status(403).json({ error: 'Doctor access denied for this patient context.' });
          }
        }

        patientContext = await prisma.user.findUnique({
          where: { id: patientId },
          select: {
            id: true,
            fullName: true,
            patientProfile: { select: { chronicConditions: true, basicHealthInfo: true } }
          }
        });
      }

      const score = basicUrgencyScore(parsed.data.symptoms);
      const fallbackUrgency = score >= 6 ? 'emergency' : score >= 3 ? 'urgent' : score >= 1 ? 'routine' : 'self-care';

      const fallback = normalizeTriageResult({
        urgencyLevel: fallbackUrgency,
        recommendedAction:
          fallbackUrgency === 'emergency'
            ? 'Seek emergency care immediately or call local emergency services.'
            : fallbackUrgency === 'urgent'
              ? 'Arrange same-day clinical review.'
              : 'Monitor symptoms and book standard consultation if they continue.',
        rationale: 'This draft urgency estimate is based on symptom keywords and must be reviewed by a clinician.',
        immediateSteps: [
          'Keep the patient hydrated and supervised.',
          'Record onset time and progression of symptoms.',
          'Prepare recent medication list for clinician review.'
        ],
        questionsToAsk: ['When did symptoms start?', 'Any worsening signs?', 'Any chronic condition interactions?'],
        dangerSigns: ['Breathing trouble', 'Chest pain', 'Confusion or fainting']
      });

      const language = safeLanguage(parsed.data.preferredLanguage || req.user.language || 'English');

      const taskPrompt = [
        'TASK: Generate a safety-first triage draft as JSON.',
        'Return JSON with keys: urgencyLevel, recommendedAction, rationale, immediateSteps, questionsToAsk, dangerSigns.',
        'Allowed urgencyLevel values: self-care, routine, urgent, emergency.',
        `Language: ${language}`,
        `Priority flag from user: ${parsed.data.priority}`,
        `Subject: ${toCleanString(parsed.data.subject, 160)}`,
        `Symptoms: ${toCleanString(parsed.data.symptoms, 3000)}`,
        `Patient context: ${patientContext ? JSON.stringify(patientContext).slice(0, 1400) : 'Not provided'}`,
        'This is not a diagnosis. Keep recommendations conservative and clear.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeTriageResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  generateReminderText: async (req, res, next) => {
    try {
      const parsed = reminderTextSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid reminder generation request.' });
      }

      const appointment = await loadAppointmentWithAccess(parsed.data.appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      const language = safeLanguage(parsed.data.language || req.user.language || appointment.patient.language || 'English');
      const tone = parsed.data.tone || 'warm';
      const channel = parsed.data.channel || 'sms';
      const patientName = appointment.familyMember?.fullName || appointment.patient.fullName;
      const startLabel = formatIstDateTime(appointment.startAt);

      const fallback = normalizeReminderResult({
        ...getReminderTemplate(language, patientName, appointment.doctor.fullName, startLabel)
      });

      const taskPrompt = [
        'TASK: Draft reminder message JSON for low-connectivity telemedicine users.',
        'Return JSON with keys: message, alternatives, scheduleHint.',
        `Language: ${language}`,
        `Tone: ${tone}`,
        `Channel: ${channel}`,
        `Patient display name: ${patientName}`,
        `Doctor name: ${appointment.doctor.fullName}`,
        `Appointment IST time: ${startLabel}`,
        'Keep message under 320 characters and avoid sensitive details.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback, maxTokens: 500 });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeReminderResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  generateReferralSummary: async (req, res, next) => {
    try {
      if (!requireRole(req.user, ['doctor', 'admin'])) {
        return res.status(403).json({ error: 'Referral summary generation is available for doctor/admin roles only.' });
      }

      const parsed = referralSummarySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid referral summary request.' });
      }

      const appointment = await loadAppointmentWithAccess(parsed.data.appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      const latestVital = await prisma.consultationVital.findFirst({
        where: { appointmentId: appointment.id },
        orderBy: { createdAt: 'desc' },
        select: {
          bpSystolic: true,
          bpDiastolic: true,
          temperatureC: true,
          spo2Percent: true,
          pulseBpm: true
        }
      });

      const age = ageFromDob(appointment.patient?.dateOfBirth);
      const gender = toCleanString(appointment.patient?.gender, 40);
      const patientIdentity = [gender || 'Patient', age != null ? `${age}` : null].filter(Boolean).join(', ');

      const chiefComplaint =
        toCleanString(appointment.problemDescription, 1000) ||
        'ongoing symptoms requiring specialist evaluation';

      const history =
        toCleanString(appointment.patient?.patientProfile?.chronicConditions, 600) ||
        toCleanString(appointment.patient?.patientProfile?.basicHealthInfo, 600) ||
        'No major chronic history documented in this visit context.';

      const prescriptionItems = Array.isArray(appointment.prescription?.items)
        ? appointment.prescription.items
            .slice(0, 4)
            .map((item) => {
              const name = toCleanString(item?.name, 80);
              const dosage = toCleanString(item?.dosage, 60);
              return [name, dosage].filter(Boolean).join(' ');
            })
            .filter(Boolean)
            .join('; ')
        : '';

      const triedTreatment =
        toCleanString(parsed.data.triedTreatment, 1200) ||
        toCleanString(appointment.medicationsText, 1200) ||
        prescriptionItems ||
        toCleanString(appointment.prescription?.instructions, 900) ||
        'Initial treatment and supportive care were attempted with limited improvement.';

      const vitalsText = latestVital
        ? [
            latestVital.bpSystolic && latestVital.bpDiastolic
              ? `BP ${latestVital.bpSystolic}/${latestVital.bpDiastolic}`
              : null,
            latestVital.temperatureC != null ? `Temp ${Number(latestVital.temperatureC).toFixed(1)}C` : null,
            latestVital.spo2Percent != null ? `SpO2 ${latestVital.spo2Percent}%` : null,
            latestVital.pulseBpm != null ? `Pulse ${latestVital.pulseBpm} bpm` : null
          ]
            .filter(Boolean)
            .join(', ')
        : '';

      const targetSpecialty = toCleanString(parsed.data.targetSpecialty, 140) || 'specialist team';
      const referralReason = toCleanString(parsed.data.referralReason, 1200);
      const urgency = formatUrgencyLabel(parsed.data.urgency);
      const language = safeLanguage(parsed.data.language || req.user.language || appointment.patient?.language || 'English');

      const fallback = normalizeReferralSummaryResult({
        summaryParagraph: `${patientIdentity} presented with ${chiefComplaint}. Relevant history: ${history}. Treatment attempted: ${triedTreatment}.${vitalsText ? ` Latest vitals: ${vitalsText}.` : ''} Referred to ${targetSpecialty} for ${referralReason}. Urgency: ${urgency}.`,
        urgency,
        referralChecklist: [
          'Attach key consultation notes and medication history.',
          'Include recent vitals and symptom timeline.',
          'Confirm specialist appointment window based on urgency.'
        ]
      });

      const taskPrompt = [
        'TASK: Generate a one-paragraph specialist referral summary JSON from telemedicine consultation context.',
        'Return JSON with keys: summaryParagraph, urgency, referralChecklist.',
        'summaryParagraph must include: chief complaint, relevant history, tried treatment, referral reason, and urgency.',
        `Language: ${language}`,
        `Patient descriptor: ${patientIdentity}`,
        `Chief complaint: ${chiefComplaint}`,
        `History context: ${history}`,
        `Tried treatment: ${triedTreatment}`,
        `Latest vitals: ${vitalsText || 'No vitals captured for this visit.'}`,
        `Referral target specialty: ${targetSpecialty}`,
        `Referral reason: ${referralReason}`,
        `Urgency: ${urgency}`,
        'Keep the paragraph concise and clinically clear. This is a draft and must be reviewed by the doctor.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback, maxTokens: 700 });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeReferralSummaryResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  suggestAsyncReply: async (req, res, next) => {
    try {
      if (!requireRole(req.user, ['doctor', 'admin', 'help_worker'])) {
        return res.status(403).json({ error: 'Async reply suggestion is available for doctor/admin/helper roles only.' });
      }

      const appointmentId = String(req.body?.appointmentId || '').trim();
      if (!isUuid(appointmentId)) {
        return res.status(400).json({ error: 'Valid appointmentId is required.' });
      }

      const appointment = await loadAppointmentWithAccess(appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      const threadSummary = toCleanString(req.body?.threadSummary, 1800);
      const latestPatientMessage = toCleanString(req.body?.latestPatientMessage, 2200);
      if (!latestPatientMessage) {
        return res.status(400).json({ error: 'latestPatientMessage is required.' });
      }

      const patientName = appointment.familyMember?.fullName || appointment.patient?.fullName || 'patient';
      const language = safeLanguage(req.body?.language || req.user.language || appointment.patient?.language || 'English');

      const fallback = normalizeAsyncReplyResult({
        suggestedReply: `Thanks for sharing this update, ${patientName}. I understand your concern. Please continue hydration and rest, and monitor for red flags such as breathing trouble, worsening fever, persistent vomiting, chest pain, or confusion. If any red flag appears, seek urgent in-person care immediately. We will review and guide the next step shortly.`,
        reasoningHighlights: [
          'Acknowledges patient concern and sets calm tone.',
          'Provides safe interim guidance without diagnosis.',
          'Includes escalation/red-flag instructions for urgent care.'
        ]
      });

      const taskPrompt = [
        'TASK: Draft an asynchronous doctor reply as JSON for telemedicine thread response.',
        'Return JSON with keys: suggestedReply, reasoningHighlights.',
        'suggestedReply must be concise, empathetic, safety-first, and non-diagnostic.',
        `Language: ${language}`,
        `Patient display name: ${patientName}`,
        `Appointment context: ${toCleanString(appointment.problemDescription, 1200) || 'No problem description available.'}`,
        `Thread summary: ${threadSummary || 'Not provided.'}`,
        `Latest patient message: ${latestPatientMessage}`,
        'Always include clear escalation guidance when danger signs are possible.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback, maxTokens: 700 });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeAsyncReplyResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  documentAssistant: async (req, res, next) => {
    try {
      const parsed = documentAssistSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid document assistant request.' });
      }

      const document = await loadDocumentWithAccess(parsed.data.documentId, req.user);
      if (!document) {
        return res.status(404).json({ error: 'Document not found or access denied.' });
      }

      const sourceTextRaw = await readDocumentText(document);
      const sourceText = normalizeExtractedText(sourceTextRaw);
      if (!sourceText) {
        return res.status(415).json({ error: 'Document assistant currently supports text-like files (txt, md, csv, json, xml).' });
      }

      const language = safeLanguage(parsed.data.language || req.user.language || 'English');
      const sourceHints = selectSourceSnippets(sourceText, parsed.data.question);

      const fallback = normalizeDocumentResult({
        answer: 'The answer below is based only on extracted text snippets. Verify directly against the full document before clinical decisions.',
        sourceSnippets: sourceHints.map((line) => ({ quote: line, why: 'Relevant line from uploaded document.' })),
        followUps: ['Confirm this interpretation with the treating clinician.', 'Review the full source file for missing context.']
      });

      const taskPrompt = [
        'TASK: Answer user question from document text and cite source snippets in JSON.',
        'Return JSON with keys: answer, sourceSnippets, followUps.',
        'sourceSnippets must be array of objects with keys: quote, why.',
        `Language: ${language}`,
        `Question: ${toCleanString(parsed.data.question, 1200)}`,
        `Document name: ${document.fileName}`,
        `Extracted text (truncated): ${sourceText.slice(0, 6000)}`,
        'Do not invent content that is not in the text. If uncertain, state that explicitly.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback, maxTokens: 900 });
      const normalized = normalizeDocumentResult(generated.data);

      if (!normalized.sourceSnippets.length && sourceHints.length) {
        normalized.sourceSnippets = sourceHints.map((line) => ({
          quote: line,
          why: 'Top matching source line'
        }));
      }

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalized
      });
    } catch (error) {
      return next(error);
    }
  },

  helperGuidance: async (req, res, next) => {
    try {
      if (!requireRole(req.user, ['help_worker', 'patient', 'admin'])) {
        return res.status(403).json({ error: 'Helper guidance is available for patients, helpers, and admins.' });
      }

      const parsed = helperGuidanceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid helper guidance request.' });
      }

      let patientId = parsed.data.patientId || null;

      if (req.user.role === 'patient') {
        if (patientId && patientId !== req.user.id) {
          return res.status(403).json({ error: 'Patients can request guidance only for themselves.' });
        }
        patientId = req.user.id;
      }

      if (req.user.role === 'help_worker') {
        const scope = await getHelperDelegationScope(req.user);

        if (!patientId && scope.linkedPatientIds.size) {
          patientId = [...scope.linkedPatientIds][0];
        }

        if (!patientId || !scope.linkedPatientIds.has(patientId)) {
          return res.status(403).json({ error: 'No delegated patient selected or active consent missing.' });
        }
      }

      if (!patientId) {
        return res.status(400).json({ error: 'patientId is required for this role.' });
      }

      const [patient, upcomingAppointments] = await Promise.all([
        prisma.user.findUnique({
          where: { id: patientId },
          select: {
            id: true,
            fullName: true,
            patientProfile: { select: { chronicConditions: true, basicHealthInfo: true } }
          }
        }),
        prisma.appointment.findMany({
          where: {
            patientId,
            status: 'booked',
            startAt: { gte: new Date() }
          },
          select: {
            id: true,
            startAt: true,
            mode: true,
            doctor: { select: { fullName: true } }
          },
          orderBy: { startAt: 'asc' },
          take: 6
        })
      ]);

      if (!patient) {
        return res.status(404).json({ error: 'Patient context not found.' });
      }

      const language = safeLanguage(parsed.data.language || req.user.language || 'English');

      const fallback = normalizeGuidanceResult({
        cards: [
          {
            title: 'Daily Check-in',
            whyItMatters: 'Consistent tracking helps detect worsening symptoms earlier.',
            checklist: ['Ask about new symptoms.', 'Check medication adherence.', 'Confirm hydration and meals.']
          },
          {
            title: 'Appointment Readiness',
            whyItMatters: 'Prepared visits improve clinical decisions during short tele-consults.',
            checklist: ['Keep phone charged.', 'Prepare medicine list.', 'Note top 3 patient concerns.']
          }
        ],
        escalationSigns: ['Breathing distress', 'Severe confusion', 'Chest pain', 'Uncontrolled bleeding'],
        handoffNote: 'Share major changes promptly with doctor and document timing of symptom changes.'
      });

      const taskPrompt = [
        'TASK: Generate helper guidance cards JSON for delegated care support.',
        'Return JSON with keys: cards, escalationSigns, handoffNote.',
        'cards must be array of objects with keys: title, whyItMatters, checklist.',
        `Language: ${language}`,
        `Care goal: ${toCleanString(parsed.data.goal, 300)}`,
        `Patient summary: ${JSON.stringify(patient).slice(0, 1400)}`,
        `Upcoming appointments: ${JSON.stringify(upcomingAppointments).slice(0, 1400)}`,
        'Keep guidance actionable for non-clinician helpers and clearly indicate escalation signs.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback, maxTokens: 900 });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeGuidanceResult(generated.data)
      });
    } catch (error) {
      return next(error);
    }
  },

  translateChat: async (req, res, next) => {
    try {
      const parsed = translateChatSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid translation request.' });
      }

      const appointment = await loadAppointmentWithAccess(parsed.data.appointmentId, req.user);
      if (!appointment) {
        return res.status(404).json({ error: 'Appointment not found or access denied.' });
      }

      const sourceLanguage = safeLanguage(parsed.data.sourceLanguage || 'auto', 'auto');
      const targetLanguage = safeLanguage(parsed.data.targetLanguage, 'English');
      const text = toCleanString(parsed.data.text, 2000);

      if (!text) {
        return res.status(400).json({ error: 'Text is required for translation.' });
      }

      if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
        return res.json({
          ok: true,
          requiresReview: true,
          fallbackUsed: false,
          model: 'passthrough',
          result: {
            translatedText: text,
            detectedSourceLanguage: sourceLanguage,
            notes: ['Source and target language are the same.']
          }
        });
      }

      const fallback = normalizeTranslateResult(
        {
          translatedText: text,
          detectedSourceLanguage: sourceLanguage,
          notes: ['Translation unavailable, original message returned.']
        },
        text
      );

      const taskPrompt = [
        'TASK: Translate telemedicine chat text and return JSON.',
        'Return JSON with keys: translatedText, detectedSourceLanguage, notes.',
        `Source language hint: ${sourceLanguage}`,
        `Target language: ${targetLanguage}`,
        `Text: ${text}`,
        'Preserve medical meaning and urgency words accurately.'
      ].join('\n');

      const generated = await runJsonTask({ taskPrompt, fallback, maxTokens: 500 });

      return res.json({
        ok: true,
        requiresReview: true,
        fallbackUsed: generated.fallbackUsed,
        model: generated.model,
        result: normalizeTranslateResult(generated.data, text)
      });
    } catch (error) {
      return next(error);
    }
  }
};

module.exports = { aiController };
