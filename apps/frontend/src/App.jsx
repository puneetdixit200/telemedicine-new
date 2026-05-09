import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams
} from 'react-router-dom';
import QRCode from 'qrcode';
import { apiRequest, utcDateTime } from './lib/api';
import TranslationService from './TranslationService';
import InnovationHubPage from './pages/InnovationHubPage';
import DoctorPatientAccessPage from './pages/DoctorPatientAccessPage';

const SessionContext = createContext(null);
const RuralSupportContext = createContext(null);
const AI_OFFLINE_DRAFTS_KEY = 'ai:offline-drafts:v1';
const ASYNC_REPLY_QUEUE_KEY = 'async:reply-queue:v1';
const HELPER_ONBOARDING_KEY = 'helper:onboarding:v1';

function readJsonStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (_err) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_err) {}
}

function formatCachedAt(timestamp) {
  if (!timestamp) return 'an unknown time';
  try {
    return new Date(timestamp).toLocaleString();
  } catch (_err) {
    return 'an unknown time';
  }
}

function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error('SessionContext not available');
  }
  return value;
}

function useRuralSupport() {
  const value = useContext(RuralSupportContext);
  if (!value) {
    throw new Error('RuralSupportContext not available');
  }
  return value;
}

function formatDoctorRating(average, count) {
  if (!count) return 'No patient ratings yet';
  return `${Number(average || 0).toFixed(1)} / 5 from ${count} review${count > 1 ? 's' : ''}`;
}

function formatPrettyDate(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatPrettyTime(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function getModeRecommendation(networkType, isOnline = true) {
  if (!isOnline) {
    return {
      mode: 'text',
      reason: 'You are offline. Text mode is safest once connectivity returns.'
    };
  }

  const normalized = String(networkType || 'unknown').toLowerCase();
  if (normalized.includes('slow-2g') || normalized === '2g') {
    return {
      mode: 'text',
      reason: 'Low bandwidth detected. Text mode reduces call drops.'
    };
  }

  if (normalized === '3g') {
    return {
      mode: 'audio',
      reason: 'Moderate network detected. Audio mode is usually more stable than video.'
    };
  }

  return {
    mode: 'video',
    reason: 'Your network can support video consultations.'
  };
}

function isPdfContentType(contentType) {
  return String(contentType || '').toLowerCase().includes('pdf');
}

function extractFirstUuid(value) {
  const match = String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match ? match[0] : '';
}

function buildPdfPreviewLink(sourcePath, title = '', downloadPath = '', appointmentId = '') {
  const source = String(sourcePath || '').trim();
  const params = new URLSearchParams();
  params.set('src', source);
  if (title) params.set('title', String(title));
  if (downloadPath) params.set('download', String(downloadPath));
  if (appointmentId) params.set('appointmentId', String(appointmentId));
  return `/pdf-preview?${params.toString()}`;
}

function parseMedicineLines(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', dosage = '', frequency = '', duration = '', quantity = '1'] = line.split(',').map((part) => part.trim());
      return {
        name,
        dosage,
        frequency,
        duration,
        quantity: Number(quantity) > 0 ? Number(quantity) : 1
      };
    })
    .filter((item) => item.name);
}

function parseCustomLabTests(rawText) {
  return String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = '', sampleType = '', instructions = ''] = line.split(',').map((part) => part.trim());
      return { name, sampleType, instructions };
    })
    .filter((item) => item.name);
}

function formatSideEffectsText(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  return String(value || '').trim();
}

const LANGUAGE_SPEECH_CODE_MAP = {
  english: 'en-IN',
  hindi: 'hi-IN',
  bengali: 'bn-IN',
  marathi: 'mr-IN',
  tamil: 'ta-IN',
  telugu: 'te-IN',
  gujarati: 'gu-IN',
  kannada: 'kn-IN',
  malayalam: 'ml-IN',
  punjabi: 'pa-IN',
  odia: 'or-IN',
  oriya: 'or-IN',
  urdu: 'ur-IN',
  assamese: 'as-IN',
  nepali: 'ne-IN'
};

const LANGUAGE_NAME_BY_CODE = {
  en: 'English',
  hi: 'Hindi',
  bn: 'Bengali',
  mr: 'Marathi',
  ta: 'Tamil',
  te: 'Telugu',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
  or: 'Odia',
  ur: 'Urdu',
  as: 'Assamese',
  ne: 'Nepali'
};

function getAppSelectedLanguage(userLanguage) {
  const fromUser = String(userLanguage || '').trim();
  if (typeof document === 'undefined') return fromUser || 'English';

  const htmlLang = String(document.documentElement?.lang || '').trim();
  const cookieMatch = document.cookie.match(/(?:^|; )googtrans=([^;]+)/i);
  const cookieValue = cookieMatch ? decodeURIComponent(cookieMatch[1]) : '';
  const cookieParts = cookieValue.split('/').filter(Boolean);
  const googleTranslatedLang = cookieParts.length ? cookieParts[cookieParts.length - 1] : '';

  return googleTranslatedLang || htmlLang || fromUser || 'English';
}

function resolvePreferredLanguageName(preferredLanguage) {
  const raw = String(preferredLanguage || '').trim();
  if (!raw) return 'English';

  const lower = raw.toLowerCase();
  if (LANGUAGE_SPEECH_CODE_MAP[lower]) {
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  const codeLike = lower.replace('_', '-');
  if (/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(codeLike)) {
    const code = codeLike.split('-')[0];
    return LANGUAGE_NAME_BY_CODE[code] || 'English';
  }

  if (/हिंदी|हिन्दी/.test(raw)) return 'Hindi';
  if (/বাংলা/.test(raw)) return 'Bengali';
  if (/मराठी/.test(raw)) return 'Marathi';
  if (/தமிழ்/.test(raw)) return 'Tamil';
  if (/తెలుగు/.test(raw)) return 'Telugu';

  return raw;
}

function extractSimplifiedPrescriptionText(result) {
  const payload = result && typeof result === 'object' ? result : {};
  const chunks = [];

  const plain = String(payload.plainLanguage || '').trim();
  if (plain) chunks.push(plain);

  const overview = String(payload.overview || '').trim();
  if (overview) chunks.push(overview);

  if (Array.isArray(payload.dailyPlan) && payload.dailyPlan.length) {
    const dailyPlanText = payload.dailyPlan
      .slice(0, 6)
      .map((entry, index) => {
        const time = String(entry?.time || '').trim();
        const whatToTake = String(entry?.whatToTake || '').trim();
        const tips = String(entry?.tips || '').trim();
        const parts = [time ? `Dose ${index + 1} at ${time}.` : `Dose ${index + 1}.`, whatToTake, tips].filter(Boolean);
        return parts.join(' ');
      })
      .filter(Boolean)
      .join(' ');

    if (dailyPlanText) chunks.push(dailyPlanText);
  }

  if (Array.isArray(payload.dosAndDonts) && payload.dosAndDonts.length) {
    chunks.push(`Important advice: ${payload.dosAndDonts.map((item) => String(item || '').trim()).filter(Boolean).join('. ')}.`);
  }

  if (Array.isArray(payload.seekHelpIf) && payload.seekHelpIf.length) {
    chunks.push(`Seek help if: ${payload.seekHelpIf.map((item) => String(item || '').trim()).filter(Boolean).join('. ')}.`);
  }

  return stripHandoffCodeFromNarration(chunks.join(' ').trim());
}

async function translateNarrationForAppointment({ appointmentId, text, targetLanguage }) {
  const sanitized = stripHandoffCodeFromNarration(text);
  if (!sanitized) return '';

  const normalizedTarget = resolvePreferredLanguageName(targetLanguage);
  if (!normalizedTarget || normalizedTarget.toLowerCase() === 'english') {
    return sanitized;
  }

  if (!appointmentId) {
    return sanitized;
  }

  const res = await apiRequest('/api/ai/translate-chat', {
    method: 'POST',
    body: {
      appointmentId,
      text: sanitized,
      sourceLanguage: 'auto',
      targetLanguage: normalizedTarget
    }
  });

  if (!res.ok) {
    return sanitized;
  }

  const translated = stripHandoffCodeFromNarration(String(res.data?.result?.translatedText || '').trim());
  return translated || sanitized;
}

function resolveSpeechLanguageCode(preferredLanguage) {
  const raw = String(preferredLanguage || '').trim();
  if (!raw) return 'en-IN';

  if (/^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(raw)) {
    if (raw.includes('-')) return raw;
    return raw.toLowerCase() === 'en' ? 'en-IN' : `${raw.toLowerCase()}-IN`;
  }

  return LANGUAGE_SPEECH_CODE_MAP[raw.toLowerCase()] || 'en-IN';
}

function resolveSpeechVoice(voices, languageCode) {
  const voiceList = Array.isArray(voices) ? voices : [];
  const code = String(languageCode || '').toLowerCase();
  const baseCode = code.split('-')[0];

  const ranked = voiceList
    .map((voice) => {
      const lang = String(voice.lang || '').toLowerCase();
      const name = String(voice.name || '').toLowerCase();
      let score = 0;

      if (lang === code) score += 14;
      else if (lang.startsWith(`${baseCode}-`)) score += 10;
      else if (lang === baseCode) score += 8;

      if (/(neural|natural|wavenet|premium)/.test(name)) score += 4;
      if (/(google|microsoft|samantha|zira|aria)/.test(name)) score += 2;
      if (!voice.localService) score += 1;

      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.voice || null;
}

function hasMatchingSpeechVoice(voices, languageCode) {
  const voiceList = Array.isArray(voices) ? voices : [];
  const code = String(languageCode || '').toLowerCase();
  const baseCode = code.split('-')[0];

  return voiceList.some((voice) => {
    const lang = String(voice?.lang || '').toLowerCase();
    return lang === code || lang.startsWith(`${baseCode}-`) || lang === baseCode;
  });
}

function loadSpeechVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    return Promise.resolve([]);
  }

  const synth = window.speechSynthesis;
  const immediate = synth.getVoices();
  if (immediate.length) {
    return Promise.resolve(immediate);
  }

  return new Promise((resolve) => {
    let finished = false;
    const settle = () => {
      if (finished) return;
      finished = true;
      synth.removeEventListener?.('voiceschanged', handleVoicesChanged);
      resolve(synth.getVoices());
    };

    const handleVoicesChanged = () => {
      settle();
    };

    synth.addEventListener?.('voiceschanged', handleVoicesChanged);
    window.setTimeout(settle, 450);
  });
}

function simplifyFrequencyForNarration(frequency, language = 'english') {
  const raw = String(frequency || '').trim();
  if (!raw) {
    return language === 'hindi' ? 'डॉक्टर के बताए समय पर' : 'as prescribed';
  }

  const normalized = raw.toLowerCase();
  const isOnce = /once\s*(daily|a\s*day)|1\s*time\s*(daily|a\s*day)|od\b/.test(normalized);
  const isTwice = /twice\s*(daily|a\s*day)|2\s*times\s*(daily|a\s*day)|bd\b/.test(normalized);
  const isThrice = /thrice\s*(daily|a\s*day)|3\s*times\s*(daily|a\s*day)|tid\b/.test(normalized);

  if (language === 'hindi') {
    if (isOnce) return 'रोज 1 बार';
    if (isTwice) return 'सुबह और शाम';
    if (isThrice) return 'सुबह, दोपहर, और शाम';
    return raw;
  }

  if (isOnce) return '1 time a day';
  if (isTwice) return 'Morning and evening';
  if (isThrice) return 'Morning, afternoon, evening';
  return raw;
}

function ensureSentence(text, fallback = '') {
  const value = String(text || fallback || '').trim();
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function buildPrescriptionNarrationText({ patientName, doctorName, diagnosis, items, instructions, followUpAt }) {
  const safeItems = Array.isArray(items) ? items : [];
  const diagnosisText = String(diagnosis || 'not specified').trim() || 'not specified';
  const instructionSimple = ensureSentence(instructions, 'Follow doctor instructions');
  const followUpText = followUpAt ? new Date(followUpAt).toLocaleDateString('en-US') : '';

  const medicineLines = safeItems.length
    ? safeItems
        .map((item) => {
          const medicineName = String(item?.name || 'this medicine').trim() || 'this medicine';
          const dosage = String(item?.dosage || 'as prescribed').trim() || 'as prescribed';
          const frequencySimple = simplifyFrequencyForNarration(item?.frequency, 'english');
          const duration = String(item?.duration || 'as advised').trim() || 'as advised';

          return [
            `Take ${medicineName}.`,
            `Take ${dosage} ${frequencySimple}.`,
            instructionSimple,
            `Take this medicine for ${duration}.`,
            followUpText ? `If not better, visit doctor on ${followUpText}.` : 'If not better, visit doctor.'
          ].join(' ');
        })
        .join(' ')
    : 'Take medicines only as prescribed. If not better, visit doctor.';

  return [`You have ${diagnosisText}.`, medicineLines].join(' ').trim();
}

function containsDevanagariScript(text) {
  return /[\u0900-\u097F]/.test(String(text || ''));
}

function buildPrescriptionNarrationTextLocalized({ language, patientName, doctorName, diagnosis, items, instructions, followUpAt }) {
  const resolvedLanguage = resolvePreferredLanguageName(language).toLowerCase();
  if (resolvedLanguage !== 'hindi') {
    return buildPrescriptionNarrationText({ patientName, doctorName, diagnosis, items, instructions, followUpAt });
  }

  const safeItems = Array.isArray(items) ? items : [];
  const diagnosisText = String(diagnosis || 'उल्लेखित नहीं').trim() || 'उल्लेखित नहीं';
  const instructionSimple = ensureSentence(instructions, 'डॉक्टर की सरल सलाह मानें');
  const followUpText = followUpAt ? new Date(followUpAt).toLocaleDateString('hi-IN') : '';

  const medicationNarration = safeItems.length
    ? safeItems
        .map((item) => {
          const medicineName = String(item?.name || 'यह दवा').trim() || 'यह दवा';
          const dosage = String(item?.dosage || 'डॉक्टर के अनुसार मात्रा').trim() || 'डॉक्टर के अनुसार मात्रा';
          const frequencySimple = simplifyFrequencyForNarration(item?.frequency, 'hindi');
          const duration = String(item?.duration || 'डॉक्टर की सलाह तक').trim() || 'डॉक्टर की सलाह तक';

          return [
            `${medicineName} लें।`,
            `${dosage} ${frequencySimple} लें।`,
            instructionSimple,
            `यह दवा ${duration} तक लें।`,
            followUpText ? `ठीक न लगे तो ${followUpText} को डॉक्टर से मिलें।` : 'ठीक न लगे तो डॉक्टर से मिलें।'
          ].join(' ');
        })
        .join(' ')
    : 'डॉक्टर की बताई दवा ही लें। ठीक न लगे तो डॉक्टर से मिलें।';

  return [`आपको ${diagnosisText} है।`, medicationNarration].join(' ').trim();
}

async function ensureNarrationLanguage({ appointmentId, targetLanguage, preferredText, fallbackText }) {
  const languageName = resolvePreferredLanguageName(targetLanguage);
  const normalizedTarget = String(languageName || 'English').trim();
  const sanitizedPreferred = stripHandoffCodeFromNarration(preferredText);
  const sanitizedFallback = stripHandoffCodeFromNarration(fallbackText);

  let candidate = sanitizedPreferred || sanitizedFallback;
  if (!candidate) return '';

  if (normalizedTarget.toLowerCase() !== 'english') {
    candidate = await translateNarrationForAppointment({
      appointmentId,
      text: candidate,
      targetLanguage: normalizedTarget
    });
  }

  candidate = stripHandoffCodeFromNarration(candidate);
  if (normalizedTarget.toLowerCase() === 'hindi' && !containsDevanagariScript(candidate)) {
    if (sanitizedFallback && containsDevanagariScript(sanitizedFallback)) {
      return sanitizedFallback;
    }
  }

  return candidate || sanitizedFallback;
}

function stripHandoffCodeFromNarration(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !/handoff\s*code|pharmacist\s*handoff/i.test(sentence))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectAppointmentChoices(payload) {
  const upcoming = Array.isArray(payload?.upcomingAppointments) ? payload.upcomingAppointments : [];
  const done = Array.isArray(payload?.doneAppointments) ? payload.doneAppointments : [];
  return [...upcoming, ...done].sort((a, b) => new Date(b.startAt) - new Date(a.startAt));
}

function IconAsset({ icon, iconSrc, className = '', alt = '' }) {
  const [failed, setFailed] = useState(false);
  const resolvedSrc = String(iconSrc || '').trim();

  if (!resolvedSrc || failed) {
    return (
      <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
        {icon}
      </span>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [networkType, setNetworkType] = useState(() => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return connection?.effectiveType || 'unknown';
  });
  const [isDataSaver, setIsDataSaver] = useState(() => {
    try {
      return window.localStorage.getItem('rural:dataSaver') === '1';
    } catch (_err) {
      return false;
    }
  });
  const [outboxCount, setOutboxCount] = useState(0);

  const refreshOutboxCount = useCallback(() => {
    const replyQueue = readJsonStorage(ASYNC_REPLY_QUEUE_KEY, []);
    const aiDrafts = readJsonStorage(AI_OFFLINE_DRAFTS_KEY, []);
    const replies = Array.isArray(replyQueue) ? replyQueue.length : 0;
    const drafts = Array.isArray(aiDrafts) ? aiDrafts.length : 0;
    setOutboxCount(replies + drafts);
  }, []);

  const flushQueuedReplies = useCallback(async () => {
    if (!navigator.onLine) return;
    const queue = readJsonStorage(ASYNC_REPLY_QUEUE_KEY, []);
    if (!Array.isArray(queue) || queue.length === 0) return;

    const remaining = [];
    for (const item of queue) {
      try {
        const threadId = String(item.threadId || '').trim();
        const body = String(item.message || '').trim();
        if (!threadId || !body) continue;
        // eslint-disable-next-line no-await-in-loop
        const res = await apiRequest(`/api/innovations/external-threads/${threadId}/messages`, {
          method: 'POST',
          body: {
            direction: 'outbound',
            body,
            deliveryStatus: 'queued'
          }
        });
        if (!res.ok) {
          remaining.push(item);
        }
      } catch (_err) {
        remaining.push(item);
      }
    }

    writeJsonStorage(ASYNC_REPLY_QUEUE_KEY, remaining);
    refreshOutboxCount();
  }, [refreshOutboxCount]);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/session');
      if (!res.ok) {
        setUser(null);
        return;
      }
      setUser(res.data?.user || null);
    } catch (_err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    const updateNetwork = () => {
      setIsOnline(navigator.onLine);
      setNetworkType(connection?.effectiveType || 'unknown');
    };

    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    connection?.addEventListener?.('change', updateNetwork);

    refreshOutboxCount();

    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      connection?.removeEventListener?.('change', updateNetwork);
    };
  }, [refreshOutboxCount]);

  useEffect(() => {
    const handleOnline = () => {
      flushQueuedReplies();
      refreshOutboxCount();
    };
    const handleStorage = () => refreshOutboxCount();

    window.addEventListener('online', handleOnline);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('storage', handleStorage);
    };
  }, [flushQueuedReplies, refreshOutboxCount]);

  useEffect(() => {
    try {
      window.localStorage.setItem('rural:dataSaver', isDataSaver ? '1' : '0');
    } catch (_err) {}

    document.body.classList.toggle('rural-data-saver', isDataSaver);
  }, [isDataSaver]);

  const contextValue = useMemo(
    () => ({ user, setUser, loading, refreshSession }),
    [user, loading, refreshSession]
  );

  const ruralSupportValue = useMemo(
    () => ({ isOnline, networkType, isDataSaver, setIsDataSaver, outboxCount, refreshOutboxCount }),
    [isOnline, networkType, isDataSaver, outboxCount, refreshOutboxCount]
  );

  if (loading) {
    return (
      <div className="loading-screen">
        <h1>Sanctuary Health</h1>
        <p>Loading your care dashboard...</p>
      </div>
    );
  }

  return (
    <SessionContext.Provider value={contextValue}>
      <RuralSupportContext.Provider value={ruralSupportValue}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/auth/login" element={<LoginPage />} />
          <Route path="/auth/register" element={<RegisterPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
          <Route path="/terms-of-service" element={<TermsOfServicePage />} />
          <Route path="/help-center" element={<HelpCenterPage />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/book" element={user?.role === 'patient' ? <BookingWizardPage /> : <Navigate to="/dashboard" replace />} />
            <Route path="/medicines" element={user?.role === 'patient' ? <MedicineCabinetPage /> : <Navigate to="/dashboard" replace />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/users/me" element={<ProfilePage />} />
            <Route path="/doctors" element={<DoctorsPage />} />
            <Route path="/doctors/:doctorId" element={<DoctorDetailPage />} />
            <Route path="/doctors/me/slots" element={user?.role === 'doctor' ? <DoctorSlotsPage /> : <Navigate to="/dashboard" replace />} />
            <Route path="/doctors/me/analytics" element={user?.role === 'doctor' ? <DoctorAnalyticsPage /> : <Navigate to="/dashboard" replace />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/appointments/impact" element={<ImpactPage />} />
            <Route path="/appointments/:appointmentId" element={<AppointmentDetailPage />} />
            <Route path="/pharmacy/orders" element={<PharmacyOrdersPage />} />
            <Route path="/labs/tests" element={<LabTestsPage />} />
            <Route path="/pdf-preview" element={<PdfPreviewPage />} />
            <Route path="/reminders" element={<RemindersPage />} />
            <Route path="/ai-copilot" element={<AICopilotPage />} />
            <Route
              path="/doctor/patient-access"
              element={user?.role === 'doctor' || user?.role === 'admin' ? <DoctorPatientAccessPage user={user} /> : <Navigate to="/dashboard" replace />}
            />
            <Route path="/innovations" element={<InnovationHubPage user={user} />} />
            <Route
              path="/support/consents"
              element={user?.role === 'patient' || user?.role === 'help_worker' ? <CareSupportPage /> : <Navigate to="/dashboard" replace />}
            />
            <Route path="/calls/:appointmentId" element={<CallPage />} />
            <Route path="/prescriptions/:appointmentId" element={<PrescriptionPage />} />
            <Route path="/patients/workspace" element={user?.role === 'patient' ? <PatientWorkspacePage /> : <Navigate to="/dashboard" replace />} />
            <Route path="/patients/me" element={<PatientHealthPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <RuralSupportLayer />
      </RuralSupportContext.Provider>
    </SessionContext.Provider>
  );
}

function LegalPage({ title, updatedAt, intro, sections }) {
  const { user } = useSession();

  return (
    <section className="stack">
      <article className="card">
        <p className="kicker">Legal & Support</p>
        <h2>{title}</h2>
        <p className="muted">Last updated: {updatedAt}</p>
        <p>{intro}</p>
      </article>

      {sections.map((section) => (
        <article className="card" key={section.heading}>
          <h3>{section.heading}</h3>
          {section.body.map((line, idx) => (
            <p key={`${section.heading}-${idx}`} className="muted">{line}</p>
          ))}
        </article>
      ))}

      <article className="card row-inline">
        <Link className="btn subtle" to={user ? '/dashboard' : '/auth/login'}>
          {user ? 'Back to Dashboard' : 'Back to Login'}
        </Link>
        <Link className="btn subtle" to="/auth/register">
          Create Account
        </Link>
      </article>
    </section>
  );
}

function PrivacyPolicyPage() {
  const sections = [
    {
      heading: 'Information We Collect',
      body: [
        'We collect profile details such as name, email, phone number, and account role to provide telemedicine access.',
        'We also store appointment details, consultation messages, reminders, and documents you upload for clinical workflows.'
      ]
    },
    {
      heading: 'How We Use Information',
      body: [
        'Your information is used to schedule visits, support doctor-patient communication, and maintain care history.',
        'Operational data may be used to improve reliability, network fallback behavior, and user safety alerts.'
      ]
    },
    {
      heading: 'Data Sharing and Access',
      body: [
        'Access is role-based: patients, doctors, admins, and delegated help workers see only permitted records.',
        'Delegated helper access requires active patient consent and can be revoked by the patient at any time.'
      ]
    },
    {
      heading: 'Your Choices',
      body: [
        'You can update your profile details and control communication preferences in your account.',
        'For account deletion or data requests, contact support through the Help Center page.'
      ]
    }
  ];

  return (
    <LegalPage
      title="Privacy Policy"
      updatedAt="March 29, 2026"
      intro="This policy explains how Telemedicine Hub handles personal and care-related information."
      sections={sections}
    />
  );
}

function TermsOfServicePage() {
  const sections = [
    {
      heading: 'Service Scope',
      body: [
        'Telemedicine Hub provides remote consultation tools, appointment coordination, reminders, and records support.',
        'Emergency medical conditions should be directed to local emergency services immediately.'
      ]
    },
    {
      heading: 'Account Responsibilities',
      body: [
        'You are responsible for keeping your login credentials secure and for activity under your account.',
        'You must provide accurate profile and health context information for safe care decisions.'
      ]
    },
    {
      heading: 'Acceptable Use',
      body: [
        'Do not misuse the platform, impersonate other users, or attempt unauthorized data access.',
        'Platform abuse may result in account suspension or termination.'
      ]
    },
    {
      heading: 'Availability and Changes',
      body: [
        'Features may evolve over time to improve care quality and network resilience.',
        'Continued use of the platform after updates implies acceptance of revised terms.'
      ]
    }
  ];

  return (
    <LegalPage
      title="Terms of Service"
      updatedAt="March 29, 2026"
      intro="These terms govern your use of Telemedicine Hub services and account access."
      sections={sections}
    />
  );
}

function HelpCenterPage() {
  const sections = [
    {
      heading: 'Common Support Topics',
      body: [
        'Login issues: verify email/password and reset credentials if needed.',
        'Call quality issues: use the in-call Data Quality button to switch between Auto, Saver, and High modes.',
        'Delegated helper access: ensure patient consent is active and linked to the helper phone number.'
      ]
    },
    {
      heading: 'Connectivity Tips',
      body: [
        'If your connection is weak, switch to Audio or Text mode from call controls.',
        'Enable Data Saver to reduce bandwidth use during low-connectivity periods.'
      ]
    },
    {
      heading: 'Contact Support',
      body: [
        'Email: support@telemedicinehub.local',
        'Hours: Monday to Saturday, 08:00 to 20:00 local time.',
        'For urgent medical emergencies, contact local emergency responders.'
      ]
    }
  ];

  return (
    <LegalPage
      title="Help Center"
      updatedAt="March 29, 2026"
      intro="Find quick fixes, guidance, and support contacts for your telemedicine journey."
      sections={sections}
    />
  );
}

function RuralSupportLayer() {
  const location = useLocation();
  const { isOnline, networkType, isDataSaver, setIsDataSaver, outboxCount } = useRuralSupport();

  const isCallRoute = /^\/calls\/[^/]+$/.test(location.pathname);
  const networkLabel = isOnline ? `Network: ${networkType}` : 'Offline mode enabled';

  return (
    <>
      {!isCallRoute ? (
        <aside className={`rural-connectivity-banner ${isOnline ? 'online' : 'offline'}`} aria-live="polite">
          <div className="rural-connectivity-copy">
            <p>
              <span className="material-symbols-outlined" aria-hidden="true">
                {isOnline ? 'network_wifi' : 'wifi_off'}
              </span>
              {networkLabel}
            </p>
            {isOnline ? (
              <small>
                Offline-ready features: appointments, prescriptions, medicine cabinet, saved notes, and queued replies.
              </small>
            ) : null}
            {!isOnline ? (
              <small>
                You can still view appointments, prescriptions, and medicines. Messages and AI drafts send when connection returns.
              </small>
            ) : null}
            {!isOnline ? (
              <small>
                Not available offline: new booking confirmation, video/audio calls, and fresh document uploads.
              </small>
            ) : null}
            {!isOnline && outboxCount > 0 ? (
              <small className="outbox-counter">⏳ {outboxCount} item{outboxCount === 1 ? '' : 's'} waiting to send</small>
            ) : null}
          </div>
          <button type="button" onClick={() => setIsDataSaver((prev) => !prev)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              {isDataSaver ? 'speed_0_5x' : 'speed'}
            </span>
            {isDataSaver ? 'Data Saver ON' : 'Data Saver OFF'}
          </button>
        </aside>
      ) : null}
    </>
  );
}

function ProtectedLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useSession();
  const [globalSearchText, setGlobalSearchText] = useState('');

  if (!user) {
    return <Navigate to="/auth/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  const pathname = location.pathname;
  const isCallRoute = /^\/calls\/[^/]+$/.test(pathname);

  const isPathActive = (target) => {
    if (target === '/dashboard') return pathname === '/dashboard';
    if (target === '/appointments') return pathname === '/appointments' || pathname.startsWith('/appointments/');
    if (target === '/ai-copilot') return pathname === '/ai-copilot';
    if (target === '/profile') return pathname === '/profile' || pathname === '/users/me';
    return pathname === target;
  };

  const mobileNavItems = [
    { to: '/dashboard', label: 'Home', icon: 'home' },
    { to: '/appointments', label: 'Visits', icon: 'calendar_today' },
    { to: '/ai-copilot', label: 'AI Help', icon: 'support_agent' },
    { to: '/profile', label: 'Profile', icon: 'person' }
  ];

  const hideMobileNav =
    /^\/appointments\/[^/]+$/.test(pathname) ||
    /^\/calls\/[^/]+$/.test(pathname) ||
    /^\/prescriptions\/[^/]+$/.test(pathname);

  const handleGlobalSearch = (event) => {
    event.preventDefault();

    const rawQuery = String(globalSearchText || '').trim();
    if (!rawQuery) {
      navigate('/dashboard');
      return;
    }

    const normalized = rawQuery.toLowerCase();
    const appointmentId = extractFirstUuid(rawQuery);
    if (appointmentId) {
      navigate(`/appointments/${appointmentId}`);
      setGlobalSearchText('');
      return;
    }

    const routeRules = [
      { keywords: ['home', 'dashboard'], to: '/dashboard' },
      { keywords: ['visit', 'visits', 'appointment', 'appointments'], to: '/appointments' },
      { keywords: ['ai', 'copilot', 'help'], to: '/ai-copilot' },
      { keywords: ['profile', 'account'], to: '/profile' },
      { keywords: ['reminder', 'reminders'], to: '/reminders' },
      { keywords: ['lab', 'labs', 'test', 'tests', 'report'], to: '/labs/tests' },
      { keywords: ['pharmacy', 'drug order', 'medicine order', 'orders'], to: '/pharmacy/orders' },
      { keywords: ['medicine', 'medicines', 'tablet', 'prescription'], to: user.role === 'patient' ? '/medicines' : '/pharmacy/orders' },
      { keywords: ['support', 'helper', 'consent'], to: '/support/consents', roles: ['patient', 'help_worker'] },
      { keywords: ['patient access', 'share token', 'access token'], to: '/doctor/patient-access', roles: ['doctor', 'admin'] },
      { keywords: ['innovation', 'triage', 'vitals', 'emergency', 'refill', 'trust'], to: '/innovations' },
      { keywords: ['book', 'booking'], to: user.role === 'patient' ? '/book' : '/appointments' }
    ];

    const matchedRoute = routeRules.find((rule) => {
      if (Array.isArray(rule.roles) && !rule.roles.includes(user.role)) return false;
      return rule.keywords.some((keyword) => normalized.includes(keyword));
    });

    if (matchedRoute) {
      navigate(matchedRoute.to);
      setGlobalSearchText('');
      return;
    }

    navigate(`/doctors?query=${encodeURIComponent(rawQuery)}`);
    setGlobalSearchText('');
  };

  if (isCallRoute) {
    return (
      <div className="app-shell call-route-shell">
        <main className="page-wrap call-route-wrap">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <nav className="main-nav unified-nav compact-search-nav" aria-label="Primary navigation">
        <form className="global-nav-search" role="search" onSubmit={handleGlobalSearch}>
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            type="search"
            value={globalSearchText}
            onChange={(event) => setGlobalSearchText(event.target.value)}
            placeholder="Search doctors, visits, labs, medicines, AI help..."
            aria-label="Search everywhere"
          />
          <button type="submit" aria-label="Run global search">
            Go
          </button>
        </form>
      </nav>

      <main className="page-wrap">
        <Outlet />
      </main>

      {!hideMobileNav ? (
        <nav className="mobile-bottom-nav" aria-label="Mobile primary navigation">
          {mobileNavItems.map((item) => (
            <Link
              key={item.to}
              className={`mobile-bottom-link ${isPathActive(item.to) ? 'active' : ''}`}
              to={item.to}
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function AuthCard({ title, subtitle, children }) {
  return (
    <section className="auth-card">
      <p className="kicker">Secure access</p>
      <h2>{title}</h2>
      <p className="muted">{subtitle}</p>
      {children}
    </section>
  );
}

function WelcomePage() {
  const { user } = useSession();

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="welcome-layout">
      <section className="welcome-card">
        <p className="kicker">Trusted Telemedicine</p>
        <h1>Your guided healthcare journey starts here</h1>
        <p className="muted">
          Simple steps, clear actions, and support designed for every comfort level.
        </p>

        <div className="welcome-points">
          <article>
            <h3>One task at a time</h3>
            <p className="muted">No complex dashboards. Just clear guidance for what to do next.</p>
          </article>
          <article>
            <h3>Built for low bandwidth</h3>
            <p className="muted">Fast, lightweight screens that work reliably in rural settings.</p>
          </article>
          <article>
            <h3>Family-friendly care</h3>
            <p className="muted">Book visits for yourself or loved ones from the same account.</p>
          </article>
        </div>

        <div className="welcome-actions">
          <Link className="btn large" to="/auth/login">
            Continue to Login
          </Link>
          <Link className="btn subtle large" to="/auth/register">
            Create New Account
          </Link>
        </div>
      </section>
    </div>
  );
}

function getBrowserCoordinates() {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.reject(new Error('Location services are not available in this browser.'));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy
        });
      },
      (error) => {
        if (error?.code === 1) {
          reject(new Error('Location permission is required to continue. Please allow location access and sign in again.'));
          return;
        }

        if (error?.code === 3) {
          reject(new Error('Location request timed out. Please try signing in again.'));
          return;
        }

        reject(new Error('Unable to read your current location. Please sign in again.'));
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      }
    );
  });
}

async function waitForSessionUser(maxAttempts = 8, delayMs = 200) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const sessionRes = await apiRequest('/api/session');
    const loggedInUser = sessionRes.ok ? sessionRes.data?.user || null : null;
    if (loggedInUser) {
      return loggedInUser;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  return null;
}

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshSession } = useSession();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [locationNotice, setLocationNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setLocationNotice('');
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: form
      });

      if (!res.ok) {
        setError(res.data?.error || 'Login failed.');
        return;
      }

      const loggedInUser = await waitForSessionUser();
      if (!loggedInUser) {
        setError('Login succeeded, but your session could not be loaded. Please try again.');
        return;
      }

      if (loggedInUser.role === 'patient') {
        setLocationNotice('Please allow location access to continue.');

        try {
          const coordinates = await getBrowserCoordinates();
          const locationRes = await apiRequest('/api/auth/session-location', {
            method: 'POST',
            body: coordinates
          });

          if (!locationRes.ok) {
            throw new Error(locationRes.data?.error || 'Unable to save your location.');
          }

          setLocationNotice('Location captured successfully.');
        } catch (locationError) {
          setLocationNotice(
            locationError.message
              ? `Signed in. Location capture skipped: ${locationError.message}`
              : 'Signed in. Location capture skipped. You can continue without sharing location.'
          );
        }
      }

      await refreshSession();

      const destination = res.data?.redirectTo || location.state?.from || '/dashboard';
      navigate(destination, { replace: true });
    } catch (_err) {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-experience auth-login-experience">
      <main className="auth-login-main">
        <section className="auth-login-showcase" aria-hidden="true">
          <div className="auth-login-showcase-image" />
          <div className="auth-login-showcase-card">
            <span className="auth-brand-mark">The Guided Journey</span>
            <h1>Your path to wellness starts with a single step.</h1>
            <p>
              Accessible telemedicine designed for rural living, bringing high-trust healthcare directly to your
              home clearing.
            </p>
          </div>
        </section>

        <section className="auth-login-panel">
          <div className="auth-mobile-brand">The Guided Journey</div>

          <div className="auth-login-panel-inner">
            <header className="auth-login-header">
              <h2>Welcome back</h2>
              <p>Please enter your details to access your sanctuary.</p>
            </header>

            {error ? <p className="auth-inline-error">{error}</p> : null}
            {locationNotice ? <p className="muted">{locationNotice}</p> : null}

            <form className="auth-form-stack" onSubmit={onSubmit}>
              <label className="auth-field-label" htmlFor="loginEmail">Email Address</label>
              <div className="auth-field-shell">
                <span className="material-symbols-outlined" aria-hidden="true">mail</span>
                <input
                  id="loginEmail"
                  type="email"
                  autoComplete="username"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="name@example.com"
                  required
                />
              </div>

              <div className="auth-field-head">
                <label className="auth-field-label" htmlFor="loginPassword">Password</label>
                <a
                  className="auth-inline-link"
                  href="#"
                  onClick={(event) => event.preventDefault()}
                >
                  Forgot Password?
                </a>
              </div>
              <div className="auth-field-shell">
                <span className="material-symbols-outlined" aria-hidden="true">lock</span>
                <input
                  id="loginPassword"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Enter your password"
                  required
                />
                <button
                  className="auth-input-toggle"
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>

              <label className="auth-checkbox-row" htmlFor="rememberDevice">
                <input
                  id="rememberDevice"
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(event) => setRememberDevice(event.target.checked)}
                />
                <span>Remember this device for 30 days</span>
              </label>

              <button className="auth-submit-btn" type="submit" disabled={busy}>
                {busy ? 'Signing in...' : 'Login'}
                <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </button>
            </form>

            <div className="auth-divider">
              <span />
              <small>OR CONTINUE WITH</small>
              <span />
            </div>

            <div className="auth-social-grid">
              <button className="auth-social-btn" type="button">
                <span className="auth-social-badge">G</span>
                <span>Google</span>
              </button>
              <button className="auth-social-btn" type="button">
                <span className="material-symbols-outlined" aria-hidden="true">phone_iphone</span>
                <span>Apple</span>
              </button>
            </div>

            <p className="auth-switch-note">
              New to The Guided Journey?
              <Link to="/auth/register">Create an account</Link>
            </p>
          </div>

          <footer className="auth-login-footer">
            <div className="auth-footer-links">
              <Link to="/privacy-policy">Privacy Policy</Link>
              <Link to="/terms-of-service">Terms of Service</Link>
              <Link to="/help-center">Help Center</Link>
            </div>
          </footer>
        </section>
      </main>

      <Link className="auth-help-fab" to="/help-center">
        <span>Need help?</span>
        <span className="auth-help-icon">
          <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
        </span>
      </Link>
    </div>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const { user, refreshSession } = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    role: 'patient',
    adminInviteCode: '',
    gender: '',
    dateOfBirth: '',
    address: '',
    language: '',
    timeZone: '',
    specialization: '',
    yearsOfExperience: '',
    qualifications: '',
    clinicName: '',
    consultationLanguages: '',
    description: ''
  });

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);

    try {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: form
      });

      if (!res.ok) {
        setError(res.data?.error || 'Registration failed.');
        return;
      }

      await refreshSession();
      navigate(res.data?.redirectTo || '/dashboard', { replace: true });
    } catch (_err) {
      setError('Unable to connect. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-register-shell">
      <main className="auth-register-main">
        <section className="auth-register-hero">
          <div className="auth-register-icon-wrap">
            <span className="material-symbols-outlined" aria-hidden="true">health_and_safety</span>
          </div>
          <h1>The Guided Journey</h1>
          <p>
            Your path to wellness starts here. Join our community for compassionate, rural-focused care.
          </p>
        </section>

        <section className="auth-register-card">
          {error ? <p className="auth-inline-error">{error}</p> : null}

          <form className="auth-register-form" onSubmit={onSubmit}>
            <div className="auth-register-grid">
              <label>
                Full Name
                <input
                  autoComplete="name"
                  value={form.fullName}
                  onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                  placeholder="Johnathan Doe"
                  required
                />
              </label>
              <label>
                Email Address
                <input
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="name@example.com"
                  required
                />
              </label>
              <label>
                Phone Number
                <input
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 000-0000"
                  required={form.role === 'help_worker'}
                />
              </label>
              <label>
                Choose Password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                  required
                />
              </label>
              <label>
                Role
                <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}>
                  <option value="patient">Patient</option>
                  <option value="doctor">Doctor</option>
                  <option value="help_worker">Help Worker</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label>
                Admin Invite Code
                <input
                  value={form.adminInviteCode}
                  onChange={(e) => setForm((prev) => ({ ...prev, adminInviteCode: e.target.value }))}
                  placeholder="Only required for admin"
                />
              </label>
              <label>
                Gender
                <input
                  value={form.gender}
                  onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value }))}
                />
              </label>
              <label>
                Date of Birth
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                />
              </label>
              <label className="auth-register-wide">
                Address
                <input
                  value={form.address}
                  onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                  required={form.role === 'help_worker'}
                />
              </label>
              <label className='black'>
                Language
                <input
                  value={form.language}
                  onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
                  required={form.role === 'help_worker'}
                />
              </label>
              <label>
                Time Zone
                <input
                  value={form.timeZone}
                  onChange={(e) => setForm((prev) => ({ ...prev, timeZone: e.target.value }))}
                  placeholder="Asia/Kolkata"
                />
              </label>
            </div>

            {form.role === 'doctor' ? (
              <div className="auth-doctor-section">
                <h3>Doctor Details</h3>
                <div className="auth-register-grid">
                  <label>
                    Specialization
                    <input
                      value={form.specialization}
                      onChange={(e) => setForm((prev) => ({ ...prev, specialization: e.target.value }))}
                    />
                  </label>
                  <label>
                    Experience (years)
                    <input
                      type="number"
                      value={form.yearsOfExperience}
                      onChange={(e) => setForm((prev) => ({ ...prev, yearsOfExperience: e.target.value }))}
                    />
                  </label>
                  <label>
                    Qualifications
                    <input
                      value={form.qualifications}
                      onChange={(e) => setForm((prev) => ({ ...prev, qualifications: e.target.value }))}
                    />
                  </label>
                  <label>
                    Clinic / Hospital
                    <input
                      value={form.clinicName}
                      onChange={(e) => setForm((prev) => ({ ...prev, clinicName: e.target.value }))}
                    />
                  </label>
                  <label className="auth-register-wide">
                    Consultation Languages
                    <input
                      value={form.consultationLanguages}
                      onChange={(e) => setForm((prev) => ({ ...prev, consultationLanguages: e.target.value }))}
                      placeholder="English, Hindi"
                    />
                  </label>
                  <label className="auth-register-wide">
                    Description
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {form.role === 'help_worker' ? (
              <div className="auth-doctor-section">
                <h3>Help Worker Details</h3>
                <p className="muted">Phone, address, and language are required so patients can link consent records to your helper account.</p>
              </div>
            ) : null}

            <button className="auth-register-submit" type="submit" disabled={busy}>
              {busy ? 'Creating account...' : 'Create account'}
              <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>

            <div className="auth-register-switch">
              <p>Already have an account?</p>
              <Link to="/auth/login">Log in to your journey</Link>
            </div>
          </form>
        </section>

        <section className="auth-register-trust-grid">
          <article>
            <span className="material-symbols-outlined" aria-hidden="true">verified_user</span>
            <div>
              <h3>Secure Data</h3>
              <p>Protected patient information</p>
            </div>
          </article>
          <article>
            <span className="material-symbols-outlined" aria-hidden="true">local_hospital</span>
            <div>
              <h3>Local Network</h3>
              <p>Real doctors, real care</p>
            </div>
          </article>
        </section>
      </main>

      <footer className="auth-register-footer">
        <div>
          <Link to="/privacy-policy">Privacy Policy</Link>
          <span>â€¢</span>
          <Link to="/terms-of-service">Terms of Service</Link>
          <span>â€¢</span>
          <Link to="/help-center">Help Center</Link>
        </div>
      </footer>
    </div>
  );
}

function DashboardPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [searchText, setSearchText] = useState('');
  const isDoctor = user.role === 'doctor';
  const isPatient = user.role === 'patient';
  const isHelper = user.role === 'help_worker';
  const [helperChecklist, setHelperChecklist] = useState(() => {
    const fallback = {
      confirmPhone: false,
      reviewConsents: false,
      openReminders: false,
      openAppointments: false
    };
    const stored = readJsonStorage(HELPER_ONBOARDING_KEY, fallback);
    return { ...fallback, ...(stored || {}) };
  });

  useEffect(() => {
    writeJsonStorage(HELPER_ONBOARDING_KEY, helperChecklist);
  }, [helperChecklist]);

  const handleSeeDoctorNow = async () => {
    setBusy(true);
    setMessage('Finding the best doctor for you...');

    try {
      const onlineRes = await apiRequest('/api/doctors?online=online');
      const onlineDoctors = onlineRes.ok ? onlineRes.data?.doctors || [] : [];

      const fallbackRes = onlineDoctors.length > 0 ? null : await apiRequest('/api/doctors');
      const doctors = onlineDoctors.length > 0 ? onlineDoctors : fallbackRes?.data?.doctors || [];

      if (doctors.length === 0) {
        setMessage('No doctors are available right now. Please try booking a visit.');
        return;
      }

      const targetDoctor = doctors[0];
      navigate(`/book?doctorId=${encodeURIComponent(targetDoctor.id)}&urgent=1`);
    } catch (_err) {
      setMessage('We could not find a doctor right now. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const specialtyCards = [
    {
      id: 'general',
      label: 'General Physician',
      icon: 'stethoscope',
      iconSrc: 'https://img.icons8.com/?size=100&id=958&format=png&color=000000',
      to: '/doctors?specialization=general'
    },
    {
      id: 'skin',
      label: 'Skin & Hair',
      icon: 'face',
      iconSrc: 'https://img.icons8.com/?size=100&id=79381&format=png&color=000000',
      to: '/doctors?specialization=dermatology'
    },
    {
      id: 'women',
      label: "Women's Health",
      icon: 'female',
      iconSrc: 'https://img.icons8.com/?size=100&id=1816&format=png&color=000000',
      to: '/doctors?specialization=gynecology'
    },
    {
      id: 'dental',
      label: 'Dental Care',
      icon: 'dentistry',
      iconSrc: 'https://img.icons8.com/?size=100&id=4948&format=png&color=000000',
      to: '/doctors?specialization=dentist'
    },
    {
      id: 'child',
      label: 'Child',
      icon: 'child_care',
      iconSrc: 'https://img.icons8.com/?size=100&id=2090&format=png&color=000000',
      to: '/doctors?specialization=pediatrics'
    },
    {
      id: 'ent',
      label: 'Ear-Nose-Throat',
      icon: 'hearing',
      iconSrc: 'https://img.icons8.com/?size=100&id=7542&format=png&color=000000',
      to: '/doctors?specialization=ent'
    },
    {
      id: 'mental',
      label: 'Mental Health',
      icon: 'psychology',
      iconSrc: 'https://img.icons8.com/?size=100&id=40521&format=png&color=000000',
      to: '/doctors?specialization=psychiatry'
    }
  ];

  const handleSearch = (event) => {
    event.preventDefault();
    const query = searchText.trim();
    if (!query) {
      navigate('/doctors');
      return;
    }
    navigate(`/doctors?query=${encodeURIComponent(query)}`);
  };

  if (isPatient) {
    return (
      <section className="sanctuary-home-page">
        <div className="sanctuary-home-desktop">
          <section className="sanctuary-home-hero">
            <h2>
              Find the care you <br />
              <span>deserve.</span>
            </h2>

            <form className="sanctuary-home-search" onSubmit={handleSearch}>
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search for clinics or doctors"
              />
              <button type="submit">Search</button>
            </form>
          </section>

          {message ? <p className="sanctuary-status-note">{message}</p> : null}

          <section className="sanctuary-home-grid" aria-label="Primary care actions">
            <Link className="sanctuary-home-feature-card" to="/book">
              <div className="sanctuary-home-feature-copy">
                <h3>Virtual Appointment</h3>
                <p>Scheduled online care at top clinics</p>
              </div>
              <span className="material-symbols-outlined sanctuary-home-feature-icon" aria-hidden="true">video_call</span>
            </Link>

            <button
              type="button"
              className="sanctuary-home-feature-card"
              onClick={handleSeeDoctorNow}
              disabled={busy}
            >
              <div className="sanctuary-home-feature-copy">
                <h3>Instant Video Consult</h3>
                <p>{busy ? 'Finding doctor availability...' : 'Connect within 10 minutes'}</p>
              </div>
              <span className="material-symbols-outlined sanctuary-home-feature-icon accent" aria-hidden="true">videocam</span>
            </button>

            <Link className="sanctuary-home-mini-card" to="/medicines">
              <span className="material-symbols-outlined" aria-hidden="true">pill</span>
              <div>
                <h3>Medicines</h3>
                <p>Delivered to your door</p>
              </div>
            </Link>

            <Link className="sanctuary-home-mini-card" to="/labs/tests">
              <span className="material-symbols-outlined" aria-hidden="true">biotech</span>
              <div>
                <h3>Lab Tests</h3>
                <p>Home sample collection</p>
              </div>
            </Link>

            <Link className="sanctuary-home-mini-card" to="/doctors">
              <span className="material-symbols-outlined" aria-hidden="true">groups</span>
              <div>
                <h3>Find Doctors</h3>
                <p>Browse trusted specialists</p>
              </div>
            </Link>
          </section>

          <section className="sanctuary-home-specialties">
            <div className="sanctuary-home-specialty-head">
              <h3>Find a Doctor for your Health Problem</h3>
              <Link to="/doctors">
                View All Specialties
                <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
              </Link>
            </div>

            <div className="sanctuary-home-specialty-grid">
              {specialtyCards.map((item) => (
                <Link key={item.id} className="sanctuary-home-specialty-item" to={item.to}>
                  <div>
                    <IconAsset
                      icon={item.icon}
                      iconSrc={item.iconSrc}
                      className="sanctuary-home-specialty-icon"
                      alt={`${item.label} icon`}
                    />
                  </div>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="sanctuary-home-mobile">
          {message ? <p className="sanctuary-status-note">{message}</p> : null}

          <section className="sanctuary-home-grid sanctuary-home-grid-mobile" aria-label="Primary mobile actions">
            <Link className="sanctuary-home-feature-card" to="/book">
              <div className="sanctuary-home-feature-copy">
                <h3>Virtual Appointment</h3>
                <p>Scheduled online care at top clinics</p>
              </div>
              <span className="material-symbols-outlined sanctuary-home-feature-icon" aria-hidden="true">video_call</span>
            </Link>

            <button
              type="button"
              className="sanctuary-home-feature-card"
              onClick={handleSeeDoctorNow}
              disabled={busy}
            >
              <div className="sanctuary-home-feature-copy">
                <h3>Instant Video Consult</h3>
                <p>{busy ? 'Finding doctor availability...' : 'Connect within 10 minutes'}</p>
              </div>
              <span className="material-symbols-outlined sanctuary-home-feature-icon accent" aria-hidden="true">videocam</span>
            </button>

            <Link className="sanctuary-home-mini-card" to="/medicines">
              <span className="material-symbols-outlined" aria-hidden="true">pill</span>
              <div>
                <h3>Medicines</h3>
                <p>Delivered to your door</p>
              </div>
            </Link>

            <Link className="sanctuary-home-mini-card" to="/labs/tests">
              <span className="material-symbols-outlined" aria-hidden="true">biotech</span>
              <div>
                <h3>Lab Tests</h3>
                <p>Home sample collection</p>
              </div>
            </Link>

            <Link className="sanctuary-home-mini-card" to="/doctors">
              <span className="material-symbols-outlined" aria-hidden="true">groups</span>
              <div>
                <h3>Find Doctors</h3>
                <p>Browse trusted specialists</p>
              </div>
            </Link>
          </section>

          <section className="sanctuary-home-specialties sanctuary-home-specialties-mobile">
            <div className="sanctuary-home-specialty-head">
              <h3>Find a Doctor for your Health Problem</h3>
            </div>

            <div className="sanctuary-home-specialty-grid sanctuary-home-specialty-grid-mobile">
              {specialtyCards.map((item) => (
                <Link key={item.id} className="sanctuary-home-specialty-item" to={item.to}>
                  <div>
                    <IconAsset
                      icon={item.icon}
                      iconSrc={item.iconSrc}
                      className="sanctuary-home-specialty-icon"
                      alt={`${item.label} icon`}
                    />
                  </div>
                  <span>{item.label}</span>
                </Link>
              ))}

              <Link className="sanctuary-home-specialty-item" to="/doctors">
                <div>
                  <span className="material-symbols-outlined" aria-hidden="true">more_horiz</span>
                </div>
                <span>More</span>
              </Link>
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="sanctuary-dashboard">
      <header className="sanctuary-hero">
        <h2 className="sanctuary-title">How can we help you today, {user.fullName}?</h2>
        <p className="sanctuary-subtitle">
          Your health journey is our priority. Choose a path below to get started.
        </p>
      </header>

      {message ? <p className="sanctuary-status-note">{message}</p> : null}

      {isHelper ? (
        <article className="card helper-onboarding-card">
          <p className="kicker">Helper onboarding</p>
          <h3>Checklist for first shift</h3>
          <label className="helper-onboarding-item">
            <input
              type="checkbox"
              checked={helperChecklist.confirmPhone}
              onChange={(event) =>
                setHelperChecklist((prev) => ({ ...prev, confirmPhone: event.target.checked }))
              }
            />
            Confirm your phone number matches delegated records.
          </label>
          <label className="helper-onboarding-item">
            <input
              type="checkbox"
              checked={helperChecklist.reviewConsents}
              onChange={(event) =>
                setHelperChecklist((prev) => ({ ...prev, reviewConsents: event.target.checked }))
              }
            />
            Review active patient consent links.
          </label>
          <label className="helper-onboarding-item">
            <input
              type="checkbox"
              checked={helperChecklist.openReminders}
              onChange={(event) =>
                setHelperChecklist((prev) => ({ ...prev, openReminders: event.target.checked }))
              }
            />
            Open reminder timeline and verify today&apos;s queue.
          </label>
          <label className="helper-onboarding-item">
            <input
              type="checkbox"
              checked={helperChecklist.openAppointments}
              onChange={(event) =>
                setHelperChecklist((prev) => ({ ...prev, openAppointments: event.target.checked }))
              }
            />
            Check delegated appointments and support notes.
          </label>
        </article>
      ) : null}

      <div className="sanctuary-grid" role="list" aria-label="Dashboard actions">
        {isPatient ? (
          <button
            type="button"
            className="sanctuary-action sanctuary-action-urgent"
            onClick={handleSeeDoctorNow}
            disabled={busy}
          >
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              medical_services
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">stethoscope</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>See a Doctor Now</strong>
              <span>Immediate care for urgent health concerns.</span>
            </span>
          </button>
        ) : isDoctor ? (
          <Link className="sanctuary-action sanctuary-action-urgent" to="/appointments">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              medical_services
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">calendar_month</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>My Appointments</strong>
              <span>Open your consultation queue and current sessions.</span>
            </span>
          </Link>
        ) : isHelper ? (
          <Link className="sanctuary-action sanctuary-action-urgent" to="/support/consents">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              volunteer_activism
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">handshake</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Consent Dashboard</strong>
              <span>Review active delegations linked to your helper profile.</span>
            </span>
          </Link>
        ) : (
          <Link className="sanctuary-action sanctuary-action-urgent" to="/appointments">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              medical_services
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">calendar_month</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>All Appointments</strong>
              <span>Open the system appointment timeline.</span>
            </span>
          </Link>
        )}

        {isPatient ? (
          <Link className="sanctuary-action sanctuary-action-book" to="/book">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              calendar_month
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">calendar_today</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Book a Visit</strong>
              <span>Schedule a consultation at your convenience.</span>
            </span>
          </Link>
        ) : isDoctor ? (
          <Link className="sanctuary-action sanctuary-action-book" to="/doctors/me/slots">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              calendar_month
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">schedule</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Manage Slots</strong>
              <span>Update your availability and consultation windows.</span>
            </span>
          </Link>
        ) : isHelper ? (
          <Link className="sanctuary-action sanctuary-action-book" to="/reminders">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              notifications
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">schedule</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Reminder Timeline</strong>
              <span>Track delegated reminders and follow-up timing.</span>
            </span>
          </Link>
        ) : (
          <Link className="sanctuary-action sanctuary-action-book" to="/appointments/impact">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              insights
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">analytics</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Operations Impact</strong>
              <span>Track high-level delivery metrics.</span>
            </span>
          </Link>
        )}

        {isPatient ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/medicines">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              medication
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">pill</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>My Medicines</strong>
              <span>View prescriptions and manage your refills.</span>
            </span>
          </Link>
        ) : isDoctor ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/appointments/impact">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              monitoring
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">monitor_heart</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Consultation Impact</strong>
              <span>Track completion rates, urgency, and follow-up load.</span>
            </span>
          </Link>
        ) : isHelper ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/reminders">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              notifications
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">schedule</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Care Reminders</strong>
              <span>See reminder timelines for delegated patients.</span>
            </span>
          </Link>
        ) : (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/appointments">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              list_alt
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">event_note</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Appointment List</strong>
              <span>Review scheduled consultations.</span>
            </span>
          </Link>
        )}

        {isPatient ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/patients/workspace">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              group
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">family_restroom</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Family Health</strong>
              <span>Coordinate healthcare for your loved ones.</span>
            </span>
          </Link>
        ) : isDoctor ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/doctors/me/analytics">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              bar_chart
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">insights</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Practice Insights</strong>
              <span>Review weekly outcomes and consultation trends.</span>
            </span>
          </Link>
        ) : isHelper ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/appointments">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              calendar_month
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">event_available</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Delegated Appointments</strong>
              <span>Open appointments where consent allows helper support.</span>
            </span>
          </Link>
        ) : (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/doctors">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              stethoscope
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">groups</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Doctor Network</strong>
              <span>Browse the active clinician directory.</span>
            </span>
          </Link>
        )}

        {isPatient ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/pharmacy/orders">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              local_pharmacy
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">medication_liquid</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Pharmacy Orders</strong>
              <span>Track medicine order status from placement to delivery.</span>
            </span>
          </Link>
        ) : null}

        {isPatient ? (
          <Link className="sanctuary-action sanctuary-action-neutral" to="/labs/tests">
            <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
              biotech
            </span>
            <span className="sanctuary-icon-badge" aria-hidden="true">
              <span className="material-symbols-outlined">science</span>
            </span>
            <span className="sanctuary-action-content">
              <strong>Lab Tests</strong>
              <span>Request tests and follow report readiness in one place.</span>
            </span>
          </Link>
        ) : null}

        <Link className="sanctuary-action sanctuary-action-neutral" to="/ai-copilot">
          <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
            smart_toy
          </span>
          <span className="sanctuary-icon-badge" aria-hidden="true">
            <span className="material-symbols-outlined">auto_awesome</span>
          </span>
          <span className="sanctuary-action-content">
            <strong>AI Copilot Workspace</strong>
            <span>Draft notes, summaries, reminders, guidance, and translations safely.</span>
          </span>
        </Link>

        <Link className="sanctuary-action sanctuary-action-neutral" to="/innovations">
          <span className="material-symbols-outlined sanctuary-bg-icon" aria-hidden="true">
            rocket_launch
          </span>
          <span className="sanctuary-icon-badge" aria-hidden="true">
            <span className="material-symbols-outlined">hub</span>
          </span>
          <span className="sanctuary-action-content">
            <strong>Innovation Hub</strong>
            <span>Use triage, referrals, QR access, trends, emergency escalation, and trust tools.</span>
          </span>
        </Link>
      </div>

      <div className="sanctuary-user-chip" aria-label="Current signed-in user">
        <span className="sanctuary-user-avatar" aria-hidden="true">
          {String(user.fullName || 'U').slice(0, 1).toUpperCase()}
        </span>
        <span className="sanctuary-user-text">Logged in as {user.fullName}</span>
        <span className="sanctuary-user-dot" aria-hidden="true" />
      </div>
    </section>
  );
}

function BookingWizardPage() {
  const { user } = useSession();
  const { networkType, isOnline } = useRuralSupport();
  const navigate = useNavigate();
  const location = useLocation();

  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const preselectedDoctorId = searchParams.get('doctorId') || '';
  const urgentMode = searchParams.get('urgent') === '1';
  const fromAppointmentId = searchParams.get('fromAppointmentId') || '';
  const isRebookFlow = searchParams.get('rebook') === '1' || Boolean(fromAppointmentId);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('Preparing your guided booking journey...');

  const [familyMembers, setFamilyMembers] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [doctorDetail, setDoctorDetail] = useState(null);

  const [selectedFor, setSelectedFor] = useState('self');
  const [selectedSymptom, setSelectedSymptom] = useState('');
  const [problemDescription, setProblemDescription] = useState('');
  const [triagePreview, setTriagePreview] = useState(null);
  const [triageBusy, setTriageBusy] = useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [mode, setMode] = useState('video');
  const [modeTouched, setModeTouched] = useState(false);

  const modeRecommendation = useMemo(() => getModeRecommendation(networkType, isOnline), [networkType, isOnline]);

  const symptomOptions = [
    { id: 'fever', icon: 'thermometer', label: 'Fever', hint: 'High temperature or chills' },
    { id: 'pain', icon: 'bolt', label: 'Pain', hint: 'Aches, sharp pain, or soreness' },
    { id: 'injury', icon: 'personal_injury', label: 'Injury', hint: 'Cuts, sprains, or bruises' },
    { id: 'skin', icon: 'dermatology', label: 'Skin Issue', hint: 'Rashes, itching, or bumps' },
    { id: 'cough', icon: 'pulmonology', label: 'Cold/Cough', hint: 'Congestion, sore throat' },
    { id: 'other', icon: 'more_horiz', label: 'Other', hint: 'Something else not listed' }
  ];

  const modeOptions = [
    { id: 'video', icon: 'videocam', label: 'Video', hint: 'High quality' },
    { id: 'audio', icon: 'call', label: 'Voice', hint: 'Clear audio' },
    { id: 'text', icon: 'chat_bubble', label: 'Text', hint: 'Asynchronous' }
  ];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      setMessage('Finding caring doctors near you...');

      try {
        const doctorsRes = await apiRequest('/api/doctors');
        if (doctorsRes.status === 401) {
          navigate('/auth/login', { replace: true });
          return;
        }
        if (!doctorsRes.ok) {
          setError(doctorsRes.data?.error || 'Unable to load doctors right now.');
          return;
        }

        const loadedDoctors = doctorsRes.data?.doctors || [];
        setDoctors(loadedDoctors);

        if (user.role === 'patient') {
          const workspaceRes = await apiRequest('/api/patients/workspace');
          if (workspaceRes.ok) {
            setFamilyMembers(workspaceRes.data?.user?.familyMembers || []);
          }
        }

        let doctorIdToSelect = preselectedDoctorId || (urgentMode ? loadedDoctors[0]?.id : '');

        if (fromAppointmentId) {
          const sourceRes = await apiRequest(`/api/appointments/${fromAppointmentId}`);
          if (sourceRes.ok && sourceRes.data?.appointment) {
            const source = sourceRes.data.appointment;
            if (source.doctorId) {
              doctorIdToSelect = source.doctorId;
            }

            setSelectedFor(source.familyMemberId || 'self');
            setProblemDescription(source.problemDescription || '');
            setSelectedSymptom('other');

            if (source.mode) {
              setMode(source.mode);
              setModeTouched(true);
            }

            setMessage('Rebooking from your previous consultation. Confirm slot and mode.');
          }
        }

        if (doctorIdToSelect) {
          setSelectedDoctorId(doctorIdToSelect);
          setStep(fromAppointmentId ? 4 : 3);
        }

        if (!fromAppointmentId) {
          setMessage('Choose who this consultation is for.');
        }
      } catch (_err) {
        setError('Unable to start booking wizard. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fromAppointmentId, navigate, preselectedDoctorId, urgentMode, user.role]);

  useEffect(() => {
    if (!selectedDoctorId) {
      setDoctorDetail(null);
      return;
    }

    const loadDoctor = async () => {
      setDoctorLoading(true);
      setError('');
      setMessage('Checking available time slots...');

      try {
        const res = await apiRequest(`/api/doctors/${selectedDoctorId}`);
        if (!res.ok) {
          setError(res.data?.error || 'Unable to load doctor profile.');
          return;
        }
        setDoctorDetail(res.data);
        setMessage('Great. Now pick a convenient time.');
      } catch (_err) {
        setError('Could not load slot availability.');
      } finally {
        setDoctorLoading(false);
      }
    };

    loadDoctor();
  }, [selectedDoctorId]);

  const availableByDate = useMemo(() => {
    const grouped = {};
    (doctorDetail?.slots || [])
      .filter((slot) => slot.status === 'available')
      .forEach((slot) => {
        const date = new Date(slot.startAt).toISOString().slice(0, 10);
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(slot);
      });

    Object.keys(grouped).forEach((date) => {
      grouped[date].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    });

    return grouped;
  }, [doctorDetail]);

  useEffect(() => {
    const dates = Object.keys(availableByDate).sort();
    if (!dates.length) return;

    if (!selectedDate || !availableByDate[selectedDate]) {
      setSelectedDate(dates[0]);
      setSelectedSlotId(availableByDate[dates[0]][0]?.id || '');
      return;
    }

    const slotStillExists = availableByDate[selectedDate].some((slot) => slot.id === selectedSlotId);
    if (!slotStillExists) {
      setSelectedSlotId(availableByDate[selectedDate][0]?.id || '');
    }
  }, [availableByDate, selectedDate, selectedSlotId]);

  useEffect(() => {
    if (step !== 4) return;
    if (modeTouched || isRebookFlow) return;
    if (mode === modeRecommendation.mode) return;
    setMode(modeRecommendation.mode);
  }, [isRebookFlow, mode, modeRecommendation.mode, modeTouched, step]);

  if (user.role === 'doctor') {
    return <Navigate to="/dashboard" replace />;
  }

  if (user.role !== 'patient') {
    return (
      <section className="card">
        <h2>Booking Wizard</h2>
        <p className="muted">The guided booking wizard is available for patient accounts.</p>
        <div className="row-inline">
          <Link className="btn" to="/doctors">
            Browse Doctors
          </Link>
          <Link className="btn subtle" to="/appointments">
            View Appointments
          </Link>
        </div>
      </section>
    );
  }

  const canContinue =
    (step === 1 && Boolean(selectedFor)) ||
    (step === 2 && Boolean(selectedSymptom)) ||
    (step === 3 && Boolean(selectedDoctorId)) ||
    (step === 4 && Boolean(selectedSlotId));

  const runLiveTriage = async () => {
    const description = problemDescription.trim();
    if (!description) {
      setTriagePreview(null);
      return;
    }

    setTriageBusy(true);
    try {
      const res = await apiRequest('/api/innovations/triage/preview', {
        method: 'POST',
        body: { problemDescription: description }
      });

      if (!res.ok) {
        setTriagePreview(null);
        return;
      }

      setTriagePreview(res.data?.triage || null);
      if (res.data?.shouldEscalate) {
        setMessage('Critical symptoms detected. Consider emergency escalation before booking.');
      }
    } catch (_error) {
      setTriagePreview(null);
    } finally {
      setTriageBusy(false);
    }
  };

  useEffect(() => {
    if (step !== 2) return undefined;
    const timer = window.setTimeout(() => {
      runLiveTriage();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [problemDescription, step]);

  const submitBooking = async () => {
    setBusy(true);
    setError('');
    setMessage('Finalizing your appointment...');

    try {
      const selectedSymptomMeta = symptomOptions.find((symptom) => symptom.id === selectedSymptom);
      const symptomSummary = [
        selectedSymptomMeta?.label ? `Primary symptom: ${selectedSymptomMeta.label}` : '',
        problemDescription.trim()
      ]
        .filter(Boolean)
        .join(' | ');

      const res = await apiRequest('/api/appointments/book', {
        method: 'POST',
        body: {
          slotId: selectedSlotId,
          mode,
          familyMemberId: selectedFor === 'self' ? '' : selectedFor,
          problemDescription: symptomSummary,
          medicationsText: ''
        }
      });

      if (!res.ok) {
        setError(res.data?.error || res.data?.message || 'Unable to book appointment.');
        return;
      }

      navigate(res.data?.redirectTo || '/appointments');
    } catch (_err) {
      setError('Booking failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const slotDates = Object.keys(availableByDate).sort();
  const selectedSlots = availableByDate[selectedDate] || [];
  const selectedSymptomMeta = symptomOptions.find((symptom) => symptom.id === selectedSymptom);

  const stepHeader =
    step === 1
      ? {
          chip: 'Step 1 of 4',
          title: 'Who needs help?',
          subtitle:
            "Select the patient profile for this consultation. We'll tailor the experience using their history."
        }
      : step === 2
        ? {
            chip: 'Step 2 of 4',
            title: 'What is the problem?',
            subtitle:
              'Select the primary symptom that is troubling today so we can route you to the right specialist.'
          }
        : step === 3
          ? {
              chip: 'Step 3 of 4',
              title: 'Choose your Doctor',
              subtitle: 'Pick a specialist who best fits your needs and availability.'
            }
          : {
              chip: 'Step 4 of 4',
              title: 'Find the perfect clearing in your day.',
              subtitle: 'Choose consultation mode, date, and time slot before confirming your booking.'
            };

  return (
    <section className="booking-sanctuary-shell">
      <header className="booking-sanctuary-header">
        <div className="booking-step-chip">{stepHeader.chip}</div>
        <h2>{stepHeader.title}</h2>
        <p>{stepHeader.subtitle}</p>
      </header>

      <div className="booking-progress-track" aria-label="Booking progress">
        {[1, 2, 3, 4].map((index) => (
          <span className={index <= step ? 'active' : ''} key={index} />
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Preparing your guided booking journey...</p> : null}
      {!loading ? <p className="muted booking-status-note">{message}</p> : null}

      {!loading && step === 1 ? (
        <div className="booking-profile-grid">
          <button
            type="button"
            className={`booking-profile-card ${selectedFor === 'self' ? 'selected' : ''}`}
            onClick={() => setSelectedFor('self')}
          >
            <div className="booking-profile-avatar">{String(user.fullName || 'U').slice(0, 1).toUpperCase()}</div>
            <strong>Myself</strong>
            <p>Primary account holder</p>
          </button>

          {familyMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`booking-profile-card ${selectedFor === member.id ? 'selected' : ''}`}
              onClick={() => setSelectedFor(member.id)}
            >
              <div className="booking-profile-avatar">{String(member.fullName || 'F').slice(0, 1).toUpperCase()}</div>
              <strong>{member.fullName}</strong>
              <p>{member.relationToPatient || 'Dependent profile'}</p>
            </button>
          ))}

          <Link className="booking-profile-card add-dependent" to="/patients/workspace">
            <div className="booking-profile-add-icon">
              <span className="material-symbols-outlined" aria-hidden="true">person_add</span>
            </div>
            <strong>Add dependent</strong>
            <p>Family member or legal ward</p>
          </Link>
        </div>
      ) : null}

      {!loading && step === 2 ? (
        <>
          <div className="booking-symptom-grid">
            {symptomOptions.map((symptom) => (
              <button
                key={symptom.id}
                type="button"
                className={`booking-symptom-card ${selectedSymptom === symptom.id ? 'selected' : ''}`}
                onClick={() => setSelectedSymptom(symptom.id)}
              >
                <div className="booking-symptom-icon" aria-hidden="true">
                  <span className="material-symbols-outlined">{symptom.icon}</span>
                </div>
                <strong>{symptom.label}</strong>
                <p>{symptom.hint}</p>
              </button>
            ))}
          </div>

          <article className="card">
            <h3>Symptom Details for AI Triage</h3>
            <textarea
              value={problemDescription}
              onChange={(event) => setProblemDescription(event.target.value)}
              placeholder="Describe severity, duration, and warning signs (for example: high fever for 2 days with breathlessness)."
              rows={4}
            />
            {triageBusy ? <p className="muted">Evaluating triage...</p> : null}
            {triagePreview ? (
              <p className="muted">
                Triage: {triagePreview.label} ({triagePreview.score}) - {triagePreview.recommendedAction}
              </p>
            ) : null}
          </article>

          <article className="booking-emergency-card">
            <div>
              <span className="booking-emergency-chip">Security First</span>
              <h3>Emergency Support</h3>
              <p>
                If you have severe breathing issues, chest pain, or heavy bleeding, seek immediate emergency care nearby.
              </p>
            </div>
            <button type="button" className="booking-emergency-btn">
              <span className="material-symbols-outlined" aria-hidden="true">call</span>
              Call Emergency Services
            </button>
          </article>
        </>
      ) : null}

      {!loading && step === 3 ? (
        <>
          {doctors.length === 0 ? <p className="journey-empty-note">No doctors found right now.</p> : null}
          <div className="booking-doctor-list">
            {doctors.map((doctor) => (
              <article
                className={`booking-doctor-card ${selectedDoctorId === doctor.id ? 'selected' : ''}`}
                key={doctor.id}
              >
                <div className="booking-doctor-avatar">{String(doctor.fullName || 'D').slice(0, 1).toUpperCase()}</div>
                <div className="booking-doctor-content">
                  <h3>Dr. {doctor.fullName}</h3>
                  <p className="booking-doctor-specialty">{doctor.doctorProfile?.specialization || 'General Medicine'}</p>
                  <div className="booking-doctor-meta">
                    <span className={`pill ${doctor.online ? 'online' : 'offline'}`}>
                      {doctor.online ? 'online now' : 'next available'}
                    </span>
                    <span className="muted">{formatDoctorRating(doctor.ratingAverage, doctor.ratingCount)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDoctorId(doctor.id);
                    setStep(4);
                  }}
                >
                  Select Doctor
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {!loading && step === 4 ? (
        <div className="booking-time-shell">
          {doctorLoading ? <p className="muted">Finding the best doctor for you and checking slots...</p> : null}

          <section>
            <h3>Consultation Mode</h3>
            <article className="card booking-mode-recommendation">
              <p className="muted">
                Recommended mode for your network ({isOnline ? networkType : 'offline'}): <strong>{modeRecommendation.mode}</strong>
              </p>
              <p className="muted">{modeRecommendation.reason}</p>
              <button
                type="button"
                className="btn subtle"
                onClick={() => {
                  setMode(modeRecommendation.mode);
                  setModeTouched(false);
                }}
              >
                Use Recommended Mode
              </button>
            </article>
            <div className="booking-mode-grid">
              {modeOptions.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={`booking-mode-card ${mode === option.id ? 'selected' : ''}`}
                  onClick={() => {
                    setMode(option.id);
                    setModeTouched(true);
                  }}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">{option.icon}</span>
                  <strong>{option.label}</strong>
                  <p>{option.hint}</p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="booking-date-head">
              <h3>Select Date</h3>
              <span>{slotDates.length} available days</span>
            </div>
            <div className="booking-date-row">
              {slotDates.length === 0 ? <p className="journey-empty-note">No dates available.</p> : null}
              {slotDates.map((date) => (
                <button
                  type="button"
                  key={date}
                  className={`booking-date-chip ${selectedDate === date ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedDate(date);
                    setSelectedSlotId(availableByDate[date]?.[0]?.id || '');
                  }}
                >
                  {new Date(date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3>Available Slots</h3>
            <div className="booking-slot-grid">
              {selectedSlots.length === 0 ? <p className="journey-empty-note">No slots for selected date.</p> : null}
              {selectedSlots.map((slot) => (
                <button
                  type="button"
                  key={slot.id}
                  className={`booking-slot-chip ${selectedSlotId === slot.id ? 'selected' : ''}`}
                  onClick={() => setSelectedSlotId(slot.id)}
                >
                  {utcDateTime(slot.startAt).slice(11, 16)} UTC
                </button>
              ))}
            </div>
          </section>

          <article className="booking-summary-card">
            {isRebookFlow ? (
              <p>
                <strong>Flow:</strong> Re-book from previous consultation
              </p>
            ) : null}
            <p>
              <strong>For:</strong>{' '}
              {selectedFor === 'self'
                ? user.fullName
                : familyMembers.find((member) => member.id === selectedFor)?.fullName || 'Family member'}
            </p>
            <p>
              <strong>Reason:</strong> {selectedSymptomMeta?.label || 'Not selected'}
            </p>
            <p>
              <strong>Doctor:</strong>{' '}
              {doctors.find((doctor) => doctor.id === selectedDoctorId)?.fullName || 'Not selected'}
            </p>
          </article>
        </div>
      ) : null}

      <div className="booking-action-bar">
        <button type="button" className="booking-back-btn" onClick={() => setStep((prev) => Math.max(1, prev - 1))} disabled={step === 1 || busy}>
          {step === 1 ? 'Cancel Booking' : 'Back'}
        </button>

        {step < 4 ? (
          <button type="button" className="booking-next-btn" onClick={() => setStep((prev) => Math.min(4, prev + 1))} disabled={!canContinue || busy}>
            Continue
            <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          </button>
        ) : (
          <button type="button" className="booking-next-btn" onClick={submitBooking} disabled={!canContinue || busy}>
            {busy ? 'Booking...' : 'Confirm Booking'}
            <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
          </button>
        )}
      </div>
    </section>
  );
}

function MedicineCabinetPage() {
  const { user } = useSession();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState(null);
  const [usingCached, setUsingCached] = useState(false);
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineMatches, setMedicineMatches] = useState([]);
  const [medicineSearchError, setMedicineSearchError] = useState('');
  const [searchingMedicines, setSearchingMedicines] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const workspaceRes = await apiRequest('/api/patients/workspace');
      if (!workspaceRes.ok) {
        setError(workspaceRes.data?.error || 'Unable to load medicine records.');
        return;
      }

      const completed = (workspaceRes.data?.completedAppointments || []).filter((item) => Boolean(item.prescription));
      const detailed = await Promise.all(
        completed.map(async (appointment) => {
          const detailsRes = await apiRequest(`/api/prescriptions/${appointment.id}`);
          const prescriptionItems = detailsRes.ok
            ? Array.isArray(detailsRes.data?.appointment?.prescription?.items)
              ? detailsRes.data.appointment.prescription.items
              : []
            : [];

          return {
            id: appointment.id,
            startAt: appointment.startAt,
            doctorName: appointment.doctor?.fullName || 'Doctor',
            diagnosis: appointment.prescription?.diagnosis || 'No diagnosis',
            handoffCode: detailsRes.ok ? detailsRes.data?.handoffCode || 'Open prescription' : 'Open prescription',
            medicineNames: prescriptionItems.map((entry) => String(entry?.name || '').trim()).filter(Boolean)
          };
        })
      );

      setItems(detailed);
      setUsingCached(false);
      setCachedAt(Date.now());
      writeJsonStorage('cached_medicine_cabinet', {
        data: detailed,
        cachedAt: Date.now()
      });
    } catch (_err) {
      const cached = readJsonStorage('cached_medicine_cabinet', null);
      if (cached?.data) {
        setItems(Array.isArray(cached.data) ? cached.data : []);
        setCachedAt(cached.cachedAt || null);
        setUsingCached(true);
        setError('Offline mode: showing last synced medicine cabinet.');
      } else {
        setError('Unable to load medicine cabinet.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const searchMedicineDetails = async (event) => {
    event.preventDefault();
    const query = String(medicineQuery || '').trim();
    if (query.length < 2) {
      setMedicineSearchError('Type at least 2 characters to search for medicine details.');
      setMedicineMatches([]);
      return;
    }

    setSearchingMedicines(true);
    setMedicineSearchError('');

    const res = await apiRequest(`/api/prescriptions/catalog/search?q=${encodeURIComponent(query)}&limit=10`);
    setSearchingMedicines(false);

    if (!res.ok) {
      setMedicineSearchError(res.data?.error || 'Unable to search medicine details right now.');
      setMedicineMatches([]);
      return;
    }

    setMedicineMatches(Array.isArray(res.data?.results) ? res.data.results : []);
    if (!Array.isArray(res.data?.results) || res.data.results.length === 0) {
      setMedicineSearchError('No matching medicines found. Try another name.');
    }
  };

  if (user.role !== 'patient') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <>
      <section className="card">
        <p className="kicker">Medicine Cabinet</p>
        <h2>Your prescriptions and handoff cards</h2>
        <p className="muted">Keep these cards ready when visiting a pharmacy or planning a follow-up.</p>
      </section>

      <section className="card medicine-search-card">
        <h3>Search Medicine Details & Side Effects</h3>
        <form className="row-inline wrap medicine-search-form" onSubmit={searchMedicineDetails}>
          <input
            value={medicineQuery}
            onChange={(event) => setMedicineQuery(event.target.value)}
            placeholder="Search by medicine name (e.g., Paracetamol)"
            aria-label="Search medicine"
          />
          <button type="submit" disabled={searchingMedicines}>
            {searchingMedicines ? 'Searching...' : 'Search'}
          </button>
        </form>
        {medicineSearchError ? <p className="error">{medicineSearchError}</p> : null}
        {medicineMatches.length > 0 ? (
          <div className="medicine-search-results">
            {medicineMatches.map((entry) => (
              <article className="medicine-search-item" key={`${entry.name}-${entry.genericName || ''}`}>
                <h4>{entry.name}</h4>
                <p className="muted">Generic: {entry.genericName || 'Not specified'}</p>
                <p>{entry.uses || 'No usage summary available.'}</p>
                <p>
                  <strong>Possible side effects:</strong>{' '}
                  {Array.isArray(entry.sideEffects) && entry.sideEffects.length ? entry.sideEffects.join(', ') : 'Not listed'}
                </p>
                <p className="muted">Caution: {entry.caution || 'Follow your doctor instructions.'}</p>
                {entry.inPatientHistory ? <span className="pill subtle">Seen in your prescription history</span> : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {loading ? <p className="muted">Organizing your medicine records...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {usingCached ? <p className="muted">Showing saved medicine cabinet from {formatCachedAt(cachedAt)}.</p> : null}

      {!loading && items.length === 0 ? <p className="muted">No medicine records found yet.</p> : null}

      <section className="medicine-grid">
        {items.map((item) => (
          <article className="card handoff-card" key={item.id}>
            <p className="muted">{utcDateTime(item.startAt)}</p>
            <h3>{item.diagnosis}</h3>
            <p className="muted">Doctor: {item.doctorName}</p>
            {item.medicineNames?.length ? (
              <p className="muted">Medicines: {item.medicineNames.slice(0, 4).join(', ')}</p>
            ) : null}

            {item.handoffCode ? (
              <div className="handoff-code-block">
                <p className="kicker">Handoff Code</p>
                <p className="handoff-code">{item.handoffCode}</p>
              </div>
            ) : null}

            <div className="row-inline">
              <Link className="btn" to={`/prescriptions/${item.id}`}>
                View Card
              </Link>
              <Link
                className="btn subtle"
                to={buildPdfPreviewLink(
                  `/api/prescriptions/${item.id}/pdf`,
                  `Prescription ${item.id}`,
                  `/api/prescriptions/${item.id}/pdf?download=1`,
                  item.id
                )}
              >
                Preview PDF
              </Link>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function PharmacyOrdersPage() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiPage('/api/pharmacy/orders');
  const [appointments, setAppointments] = useState([]);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    appointmentId: '',
    pharmacyName: '',
    pharmacyContact: '',
    deliveryAddress: '',
    notes: '',
    itemsText: ''
  });

  const canCreate = user.role === 'patient' || user.role === 'doctor' || user.role === 'admin';

  useEffect(() => {
    let cancelled = false;

    const loadAppointments = async () => {
      if (!canCreate) return;
      const res = await apiRequest('/api/appointments');
      if (!cancelled && res.ok) {
        setAppointments(collectAppointmentChoices(res.data));
      }
    };

    loadAppointments();
    return () => {
      cancelled = true;
    };
  }, [canCreate]);

  const submitOrder = async (event) => {
    event.preventDefault();
    setMessage('');

    const payload = {
      appointmentId: form.appointmentId || '',
      pharmacyName: form.pharmacyName,
      pharmacyContact: form.pharmacyContact,
      deliveryAddress: form.deliveryAddress,
      notes: form.notes,
      items: parseMedicineLines(form.itemsText)
    };

    const res = await apiRequest('/api/pharmacy/orders', {
      method: 'POST',
      body: payload
    });

    if (!res.ok) {
      setMessage(res.data?.error || 'Unable to create pharmacy order.');
      return;
    }

    setMessage('Pharmacy order placed.');
    setForm({
      appointmentId: '',
      pharmacyName: '',
      pharmacyContact: '',
      deliveryAddress: '',
      notes: '',
      itemsText: ''
    });
    reload();
  };

  const updateOrderStatus = async (orderId, status) => {
    setMessage('');
    const res = await apiRequest(`/api/pharmacy/orders/${orderId}/status`, {
      method: 'POST',
      body: { status }
    });

    if (!res.ok) {
      setMessage(res.data?.error || 'Unable to update order status.');
      return;
    }

    setMessage(`Order moved to ${status.replace('_', ' ')}.`);
    reload();
  };

  if (loading) return <p className="muted">Loading pharmacy orders...</p>;
  if (error) return <p className="error">{error}</p>;

  const orders = data?.orders || [];
  const summary = data?.summary || {};

  return (
    <section className="stack">
      <article className="card">
        <p className="kicker">Medical Store</p>
        <h2>Pharmacy Orders</h2>
        <p className="muted">Track medication order lifecycle from handoff to fulfillment.</p>
        <div className="row-inline wrap">
          <span className="pill">Placed: {summary.placed || 0}</span>
          <span className="pill">Processing: {summary.processing || 0}</span>
          <span className="pill">Ready: {summary.ready || 0}</span>
          <span className="pill">Delivered: {summary.delivered || 0}</span>
        </div>
      </article>

      {message ? <p className={message.toLowerCase().includes('unable') ? 'error' : 'success'}>{message}</p> : null}

      {canCreate ? (
        <article className="card">
          <h3>Create Pharmacy Order</h3>
          <form className="stack" onSubmit={submitOrder}>
            <label>
              Appointment (optional)
              <select
                value={form.appointmentId}
                onChange={(event) => setForm((prev) => ({ ...prev, appointmentId: event.target.value }))}
              >
                <option value="">No linked appointment</option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {utcDateTime(appointment.startAt)} - {appointment.doctor?.fullName || 'Doctor'}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid two">
              <label>
                Preferred pharmacy
                <input
                  value={form.pharmacyName}
                  onChange={(event) => setForm((prev) => ({ ...prev, pharmacyName: event.target.value }))}
                />
              </label>
              <label>
                Pharmacy contact
                <input
                  value={form.pharmacyContact}
                  onChange={(event) => setForm((prev) => ({ ...prev, pharmacyContact: event.target.value }))}
                />
              </label>
            </div>

            <label>
              Delivery address
              <input
                value={form.deliveryAddress}
                onChange={(event) => setForm((prev) => ({ ...prev, deliveryAddress: event.target.value }))}
              />
            </label>

            <label>
              Medicines (one per line: name, dosage, frequency, duration, quantity)
              <textarea
                value={form.itemsText}
                onChange={(event) => setForm((prev) => ({ ...prev, itemsText: event.target.value }))}
                placeholder="Paracetamol 500mg, 1 tablet, twice daily, 5 days, 10"
                required
              />
            </label>

            <label>
              Notes
              <textarea
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </label>

            <button type="submit">Place Order</button>
          </form>
        </article>
      ) : null}

      <article className="card">
        <h3>Order Timeline</h3>
        {orders.length === 0 ? <p className="muted">No pharmacy orders found.</p> : null}

        <div className="stack">
          {orders.map((order) => (
            <article key={order.id} className="list-item">
              <div>
                <strong>{order.pharmacyName || 'Pharmacy Order'}</strong>
                <p className="muted">
                  {utcDateTime(order.createdAt)} | {order.items?.length || 0} medicine(s) | status: {order.status}
                </p>
                {order.handoffCode ? <p className="muted">Handoff code: {order.handoffCode}</p> : null}
              </div>

              <div className="row-inline wrap">
                {order.appointmentId ? (
                  <Link
                    className="btn subtle"
                    to={buildPdfPreviewLink(
                      `/api/prescriptions/${order.appointmentId}/pdf`,
                      `Prescription ${order.appointmentId}`,
                      `/api/prescriptions/${order.appointmentId}/pdf?download=1`,
                      order.appointmentId
                    )}
                  >
                    Prescription PDF
                  </Link>
                ) : null}

                {user.role === 'patient' && order.status !== 'delivered' && order.status !== 'cancelled' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'delivered')}>
                    Mark Delivered
                  </button>
                ) : null}
                {user.role === 'patient' && order.status !== 'cancelled' && order.status !== 'delivered' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'cancelled')}>
                    Cancel
                  </button>
                ) : null}

                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'placed' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'processing')}>
                    Start Processing
                  </button>
                ) : null}
                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'processing' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'ready')}>
                    Mark Ready
                  </button>
                ) : null}
                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'ready' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'delivered')}>
                    Mark Delivered
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}

function LabTestsPage() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiPage('/api/labs/orders');
  const [catalog, setCatalog] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedTests, setSelectedTests] = useState([]);
  const [message, setMessage] = useState('');
  const [reportDocumentIds, setReportDocumentIds] = useState({});
  const [form, setForm] = useState({
    appointmentId: '',
    clinicalNotes: '',
    customTestsText: ''
  });

  const canCreate = user.role === 'patient' || user.role === 'doctor' || user.role === 'admin';

  useEffect(() => {
    let cancelled = false;

    const loadPageData = async () => {
      const [catalogRes, appointmentsRes] = await Promise.all([
        apiRequest('/api/labs/catalog'),
        canCreate ? apiRequest('/api/appointments') : Promise.resolve({ ok: false })
      ]);

      if (!cancelled && catalogRes.ok) {
        setCatalog(catalogRes.data?.tests || []);
      }

      if (!cancelled && appointmentsRes.ok) {
        setAppointments(collectAppointmentChoices(appointmentsRes.data));
      }
    };

    loadPageData();
    return () => {
      cancelled = true;
    };
  }, [canCreate]);

  const toggleCatalogSelection = (testId) => {
    setSelectedTests((prev) =>
      prev.includes(testId) ? prev.filter((id) => id !== testId) : [...prev, testId]
    );
  };

  const submitLabOrder = async (event) => {
    event.preventDefault();
    setMessage('');

    const payload = {
      appointmentId: form.appointmentId || '',
      clinicalNotes: form.clinicalNotes,
      testCatalogIds: selectedTests,
      customTests: parseCustomLabTests(form.customTestsText)
    };

    const res = await apiRequest('/api/labs/orders', {
      method: 'POST',
      body: payload
    });

    if (!res.ok) {
      setMessage(res.data?.error || 'Unable to create lab order.');
      return;
    }

    setMessage('Lab order created.');
    setSelectedTests([]);
    setForm({ appointmentId: '', clinicalNotes: '', customTestsText: '' });
    reload();
  };

  const updateOrderStatus = async (orderId, status) => {
    setMessage('');
    const res = await apiRequest(`/api/labs/orders/${orderId}/status`, {
      method: 'POST',
      body: { status }
    });

    if (!res.ok) {
      setMessage(res.data?.error || 'Unable to update lab status.');
      return;
    }

    setMessage(`Lab order moved to ${status.replace('_', ' ')}.`);
    reload();
  };

  const attachReport = async (orderId) => {
    const documentId = String(reportDocumentIds[orderId] || '').trim();
    if (!documentId) {
      setMessage('Enter a PDF document ID before attaching report.');
      return;
    }

    const res = await apiRequest(`/api/labs/orders/${orderId}/report`, {
      method: 'POST',
      body: { documentId }
    });

    if (!res.ok) {
      setMessage(res.data?.error || 'Unable to link lab report.');
      return;
    }

    setMessage('Lab report linked.');
    setReportDocumentIds((prev) => ({ ...prev, [orderId]: '' }));
    reload();
  };

  if (loading) return <p className="muted">Loading lab workflows...</p>;
  if (error) return <p className="error">{error}</p>;

  const orders = data?.orders || [];
  const summary = data?.summary || {};

  return (
    <section className="stack">
      <article className="card">
        <p className="kicker">Lab System</p>
        <h2>Lab Tests and Reports</h2>
        <p className="muted">Create test requests, track sample processing, and preview reports in app.</p>
        <div className="row-inline wrap">
          <span className="pill">Requested: {summary.requested || 0}</span>
          <span className="pill">Processing: {summary.processing || 0}</span>
          <span className="pill">Report Ready: {summary.report_ready || 0}</span>
          <span className="pill">Completed: {summary.completed || 0}</span>
        </div>
      </article>

      {message ? <p className={message.toLowerCase().includes('unable') ? 'error' : 'success'}>{message}</p> : null}

      {canCreate ? (
        <article className="card">
          <h3>Create Lab Order</h3>
          <form className="stack" onSubmit={submitLabOrder}>
            <label>
              Appointment (optional)
              <select
                value={form.appointmentId}
                onChange={(event) => setForm((prev) => ({ ...prev, appointmentId: event.target.value }))}
              >
                <option value="">No linked appointment</option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {utcDateTime(appointment.startAt)} - {appointment.doctor?.fullName || 'Doctor'}
                  </option>
                ))}
              </select>
            </label>

            <div className="lab-catalog-grid">
              {catalog.map((test) => (
                <label key={test.id} className="lab-catalog-item">
                  <input
                    type="checkbox"
                    checked={selectedTests.includes(test.id)}
                    onChange={() => toggleCatalogSelection(test.id)}
                  />
                  <div>
                    <strong>{test.name}</strong>
                    <p className="muted">{test.code} | {test.sampleType || 'Sample TBC'}</p>
                  </div>
                </label>
              ))}
            </div>

            <label>
              Additional custom tests (one per line: name, sampleType, instructions)
              <textarea
                value={form.customTestsText}
                onChange={(event) => setForm((prev) => ({ ...prev, customTestsText: event.target.value }))}
                placeholder="Serum Iron, Blood, Morning sample"
              />
            </label>

            <label>
              Clinical notes
              <textarea
                value={form.clinicalNotes}
                onChange={(event) => setForm((prev) => ({ ...prev, clinicalNotes: event.target.value }))}
              />
            </label>

            <button type="submit">Create Lab Order</button>
          </form>
        </article>
      ) : null}

      <article className="card">
        <h3>Lab Order Timeline</h3>
        {orders.length === 0 ? <p className="muted">No lab orders found.</p> : null}

        <div className="stack">
          {orders.map((order) => (
            <article key={order.id} className="list-item">
              <div>
                <strong>{order.familyMember?.fullName || order.patient?.fullName || 'Patient'}</strong>
                <p className="muted">
                  {utcDateTime(order.createdAt)} | {order.items?.length || 0} test(s) | status: {order.status}
                </p>
                <p className="muted">
                  {(order.items || []).map((item) => item.testName).join(', ') || 'No test names'}
                </p>
                {order.reportDocument ? (
                  <Link
                    className="btn subtle"
                    to={buildPdfPreviewLink(
                      `/api/documents/${order.reportDocument.id}/preview`,
                      order.reportDocument.fileName,
                      `/api/documents/${order.reportDocument.id}/download`
                    )}
                  >
                    Preview Report
                  </Link>
                ) : null}
              </div>

              <div className="row-inline wrap">
                {user.role === 'patient' && order.status !== 'cancelled' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'cancelled')}>
                    Cancel
                  </button>
                ) : null}

                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'requested' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'sample_collected')}>
                    Sample Collected
                  </button>
                ) : null}
                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'sample_collected' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'processing')}>
                    Mark Processing
                  </button>
                ) : null}
                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'processing' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'report_ready')}>
                    Mark Report Ready
                  </button>
                ) : null}
                {(user.role === 'doctor' || user.role === 'admin') && order.status === 'report_ready' ? (
                  <button type="button" className="btn subtle" onClick={() => updateOrderStatus(order.id, 'completed')}>
                    Complete Order
                  </button>
                ) : null}

                {(user.role === 'doctor' || user.role === 'admin') && !order.reportDocument ? (
                  <div className="row-inline wrap">
                    <input
                      className="lab-report-input"
                      placeholder="Report document ID"
                      value={reportDocumentIds[order.id] || ''}
                      onChange={(event) =>
                        setReportDocumentIds((prev) => ({
                          ...prev,
                          [order.id]: event.target.value
                        }))
                      }
                    />
                    <button type="button" className="btn subtle" onClick={() => attachReport(order.id)}>
                      Link Report
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}

function PdfPreviewPage() {
  const { user } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioMessage, setAudioMessage] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [narrationText, setNarrationText] = useState('');
  const [narrationLanguageCode, setNarrationLanguageCode] = useState('');
  const [narrationLanguageLabel, setNarrationLanguageLabel] = useState('');
  const [narrationAppointmentId, setNarrationAppointmentId] = useState('');

  const rawSource = String(query.get('src') || '').trim();
  const rawDownload = String(query.get('download') || rawSource).trim();
  const rawAppointmentId = String(query.get('appointmentId') || '').trim();
  const title = String(query.get('title') || 'PDF preview');

  const sourcePath = rawSource.startsWith('/') ? rawSource : '';
  const downloadPath = rawDownload.startsWith('/') ? rawDownload : sourcePath;
  const allowedSource = sourcePath.startsWith('/api/') || sourcePath.startsWith('/documents/');
  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && Boolean(window.speechSynthesis) && Boolean(window.SpeechSynthesisUtterance),
    []
  );

  const prescriptionAppointmentId = useMemo(() => {
    const explicitId = extractFirstUuid(rawAppointmentId);
    if (explicitId) return explicitId;

    const match = sourcePath.match(/^\/api\/prescriptions\/([^/]+)\/pdf/i);
    if (match?.[1]) {
      const decoded = decodeURIComponent(match[1]);
      const sourceId = extractFirstUuid(decoded) || decoded;
      return sourceId;
    }

    const titleId = extractFirstUuid(title);
    return titleId || '';
  }, [rawAppointmentId, sourcePath, title]);

  const canListenPrescription = Boolean(prescriptionAppointmentId);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopPrescriptionAudio = () => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    setAudioBusy(false);
    setIsPlayingAudio(false);
    setAudioMessage('Audio stopped.');
  };

  const playPrescriptionAudio = async () => {
    if (!canListenPrescription) return;
    if (!speechSupported) {
      setAudioMessage('Audio playback is not available in this browser.');
      return;
    }

    setAudioBusy(true);
    setAudioMessage('');

    try {
      let textToSpeak = stripHandoffCodeFromNarration(String(narrationText || '').trim());
      const selectedAppLanguage = getAppSelectedLanguage(user?.language || 'English');
      const selectedLanguageLabel = resolvePreferredLanguageName(selectedAppLanguage);
      let languageCode = resolveSpeechLanguageCode(selectedAppLanguage);
      let languageLabel = selectedLanguageLabel;

      const shouldRefreshNarration =
        !textToSpeak ||
        narrationAppointmentId !== prescriptionAppointmentId ||
        String(narrationLanguageLabel || '').trim().toLowerCase() !== selectedLanguageLabel.toLowerCase();

      if (shouldRefreshNarration) {
        const detailsRes = await apiRequest(`/api/prescriptions/${prescriptionAppointmentId}`);
        if (!detailsRes.ok || !detailsRes.data?.appointment?.prescription) {
          setAudioMessage('Prescription details are not available for audio right now.');
          return;
        }

        const appointment = detailsRes.data.appointment;
        const preferredLanguage = getAppSelectedLanguage(user?.language || appointment.patient?.language || 'English');
        const preferredLanguageName = resolvePreferredLanguageName(preferredLanguage);
        languageCode = resolveSpeechLanguageCode(preferredLanguage);
        languageLabel = preferredLanguageName;

        const localizedScriptText = buildPrescriptionNarrationTextLocalized({
          language: preferredLanguageName,
          patientName: appointment.familyMember?.fullName || appointment.patient?.fullName || '',
          doctorName: `Dr. ${appointment.doctor?.fullName || 'your doctor'}`,
          diagnosis: appointment.prescription?.diagnosis || '',
          items: appointment.prescription?.items || [],
          instructions: appointment.prescription?.instructions || '',
          followUpAt: appointment.prescription?.followUpAt || null
        });

        textToSpeak = await ensureNarrationLanguage({
          appointmentId: appointment.id,
          targetLanguage: preferredLanguageName,
          preferredText: localizedScriptText,
          fallbackText: localizedScriptText
        });

        setNarrationText(textToSpeak);
        setNarrationLanguageCode(languageCode);
        setNarrationLanguageLabel(languageLabel);
        setNarrationAppointmentId(prescriptionAppointmentId);
      }

      textToSpeak = stripHandoffCodeFromNarration(textToSpeak);
      if (!textToSpeak) {
        setAudioMessage('No prescription summary text is available to play.');
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = languageCode;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;

      const voices = await loadSpeechVoices();
      const hasTargetLanguageVoice = hasMatchingSpeechVoice(voices, languageCode);
      const preferredVoice = resolveSpeechVoice(voices, languageCode);
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => {
        setIsPlayingAudio(true);
        if (hasTargetLanguageVoice) {
          setAudioMessage(`Playing in ${languageLabel || languageCode}.`);
        } else {
          setAudioMessage(`Playing with device default voice. ${languageLabel || languageCode} voice is not installed on this device.`);
        }
      };

      utterance.onend = () => {
        setIsPlayingAudio(false);
        setAudioMessage('Audio playback finished.');
      };

      utterance.onerror = () => {
        setIsPlayingAudio(false);
        setAudioMessage('Unable to play prescription audio. Please try again.');
      };

      window.speechSynthesis.speak(utterance);
    } catch (_err) {
      setAudioMessage('Unable to prepare prescription audio. Please try again.');
    } finally {
      setAudioBusy(false);
    }
  };

  if (!allowedSource) {
    return (
      <section className="card">
        <h2>PDF Preview</h2>
        <p className="error">Invalid preview source.</p>
        <button type="button" onClick={() => navigate(-1)}>
          Go Back
        </button>
      </section>
    );
  }

  return (
    <section className="pdf-preview-shell">
      <header className="pdf-preview-header card">
        <div>
          <p className="kicker">In-app Preview</p>
          <h2>{title}</h2>
          {canListenPrescription ? (
            <p className={`pdf-preview-audio-note ${audioMessage.toLowerCase().includes('unable') ? 'error' : 'muted'}`}>
              {audioMessage || `Tap listen to hear this prescription in ${narrationLanguageLabel || user?.language || 'your preferred language'}.`}
            </p>
          ) : null}
        </div>
        <div className="row-inline wrap">
          <button type="button" className="btn subtle" onClick={() => navigate(-1)}>
            Back
          </button>
          <a className="btn subtle" href={sourcePath} target="_blank" rel="noreferrer">
            Open New Tab
          </a>
          <a className="btn" href={downloadPath} target="_blank" rel="noreferrer">
            Download
          </a>
          {canListenPrescription ? (
            <button
              type="button"
              className="btn subtle"
              onClick={playPrescriptionAudio}
              disabled={audioBusy || isPlayingAudio}
            >
              {audioBusy ? 'Preparing audio...' : isPlayingAudio ? 'Playing...' : 'Listen Prescription'}
            </button>
          ) : null}
          {canListenPrescription ? (
            <button type="button" className="btn subtle" onClick={stopPrescriptionAudio} disabled={!isPlayingAudio}>
              Stop Audio
            </button>
          ) : null}
        </div>
      </header>

      <article className="card pdf-preview-card">
        <iframe className="pdf-preview-frame" src={sourcePath} title={title} />
      </article>
    </section>
  );
}

function useApiPage(path) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [cacheMeta, setCacheMeta] = useState({ fromCache: false, cachedAt: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const readCached = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(`api-cache:${path}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data')) {
        return parsed;
      }
      return { data: parsed, cachedAt: null };
    } catch (_err) {
      return null;
    }
  }, [path]);

  const writeCached = useCallback(
    (value) => {
      try {
        window.localStorage.setItem(
          `api-cache:${path}`,
          JSON.stringify({
            data: value,
            cachedAt: Date.now()
          })
        );
      } catch (_err) {}
    },
    [path]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const res = await apiRequest(path);
      if (res.status === 401) {
        navigate('/auth/login', { replace: true });
        return;
      }
      if (!res.ok) {
        const cached = readCached();
        if (cached) {
          setData(cached.data);
          setCacheMeta({ fromCache: true, cachedAt: cached.cachedAt || null });
          setError('Live data unavailable. Showing last saved copy.');
          return;
        }
        setError(res.data?.error || 'Failed to load page.');
        return;
      }
      if (res.data?.redirectTo) {
        navigate(res.data.redirectTo);
        return;
      }
      setData(res.data);
      setCacheMeta({ fromCache: false, cachedAt: Date.now() });
      writeCached(res.data);
    } catch (_err) {
      const cached = readCached();
      if (cached) {
        setData(cached.data);
        setCacheMeta({ fromCache: true, cachedAt: cached.cachedAt || null });
        setError('You appear offline. Showing last saved copy.');
        return;
      }
      setError('Unable to load data.');
    } finally {
      setLoading(false);
    }
  }, [path, navigate, readCached, writeCached]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, setData, cacheMeta, error, loading, reload: load };
}

function DoctorsPage() {
  const { user } = useSession();
  const [filters, setFilters] = useState({ specialization: '', language: '', online: 'all' });
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState(null);
  const [usingCached, setUsingCached] = useState(false);
  const navigate = useNavigate();

  const fetchDoctors = useCallback(async () => {
    if (user.role === 'doctor') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    const qs = new URLSearchParams();
    if (filters.specialization) qs.set('specialization', filters.specialization);
    if (filters.language) qs.set('language', filters.language);
    if (filters.online) qs.set('online', filters.online);

    try {
      const res = await apiRequest(`/api/doctors?${qs.toString()}`);
      if (res.status === 401) {
        navigate('/auth/login');
        return;
      }
      if (!res.ok) {
        const cached = readJsonStorage('cached_doctors', null);
        if (cached?.data) {
          setPayload(cached.data);
          setCachedAt(cached.cachedAt || null);
          setUsingCached(true);
          setError('Live doctor search unavailable. Showing saved results.');
          return;
        }
        setError(res.data?.error || 'Failed to load doctors.');
        return;
      }
      if (res.data?.redirectTo) {
        navigate(res.data.redirectTo);
        return;
      }
      setPayload(res.data);
      setUsingCached(false);
      setCachedAt(Date.now());
      writeJsonStorage('cached_doctors', {
        data: res.data,
        query: filters,
        cachedAt: Date.now()
      });
    } catch (_err) {
      const cached = readJsonStorage('cached_doctors', null);
      if (cached?.data) {
        setPayload(cached.data);
        setCachedAt(cached.cachedAt || null);
        setUsingCached(true);
        setError('Offline mode: showing saved doctor search results.');
        return;
      }
      setError('Unable to load doctors.');
    } finally {
      setLoading(false);
    }
  }, [filters, navigate, user.role]);

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  if (user.role === 'doctor') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <>
      <section className="journey-hero">
        <h2 className="journey-title">
          Find your <span className="journey-accent">trusted</span> specialist.
        </h2>
        <p className="journey-sub">
          Expert care is just a moment away. Search from our verified network of doctors ready to guide your health journey.
        </p>
      </section>

      <section className="journey-controls-grid">
        <div className="journey-search-shell">
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            value={filters.specialization}
            onChange={(e) => setFilters((prev) => ({ ...prev, specialization: e.target.value }))}
            placeholder="Search by name, specialty, or clinic..."
          />
        </div>

        <div className="journey-filter-shell">
          <label>
            <span className="material-symbols-outlined" aria-hidden="true">language</span>
            <input
              value={filters.language}
              onChange={(e) => setFilters((prev) => ({ ...prev, language: e.target.value }))}
              placeholder="Language"
            />
          </label>
        </div>
      </section>

      <section className="journey-pill-row" aria-label="Doctor availability filters">
        <button
          type="button"
          className={`journey-pill ${filters.online === 'all' ? 'active' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, online: 'all' }))}
        >
          All Doctors
        </button>
        <button
          type="button"
          className={`journey-pill ${filters.online === 'online' ? 'active' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, online: 'online' }))}
        >
          Online Now
        </button>
        <button
          type="button"
          className={`journey-pill ${filters.online === 'offline' ? 'active' : ''}`}
          onClick={() => setFilters((prev) => ({ ...prev, online: 'offline' }))}
        >
          Offline
        </button>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {usingCached ? <p className="muted">Showing saved doctor list from {formatCachedAt(cachedAt)}.</p> : null}
      {loading ? <p className="muted">Loading doctors...</p> : null}

      <section className="journey-doctors-grid">
        {(payload?.doctors || []).map((doctor) => (
          <article className="journey-doctor-card" key={doctor.id}>
            <div className="journey-doctor-top">
              <div className="journey-doctor-avatar">{String(doctor.fullName || 'D').slice(0, 1).toUpperCase()}</div>
              <span className={`journey-online-badge ${doctor.online ? 'online' : 'offline'}`}>
                <span className="journey-dot" />
                {doctor.online ? 'online' : 'offline'}
              </span>
            </div>

            <div className="journey-doctor-content">
              <h3>Dr. {doctor.fullName}</h3>
              <p className="journey-specialty">{doctor.doctorProfile?.specialization || 'General Medicine'}</p>
              <p className="journey-meta">{formatDoctorRating(doctor.ratingAverage, doctor.ratingCount)}</p>
              <p className="journey-meta">Trust score: {doctor.trust?.score ?? 0} / 100</p>
              <p className="journey-meta">
                {doctor.doctorProfile?.consultationLanguages
                  ? `Languages: ${doctor.doctorProfile.consultationLanguages}`
                  : 'Languages: Not specified'}
              </p>
              {!doctor.online && doctor.doctorProfile?.statusMessage ? (
                <p className="journey-meta">Offline note: {doctor.doctorProfile.statusMessage}</p>
              ) : null}
            </div>

            <Link className="journey-cta" to={`/doctors/${doctor.id}`}>
              View and book
            </Link>
          </article>
        ))}

        {!loading && (payload?.doctors || []).length === 0 ? (
          <article className="journey-doctor-empty">
            <span className="material-symbols-outlined" aria-hidden="true">clinical_notes</span>
            <p>No doctors match your current filters.</p>
          </article>
        ) : null}
      </section>
    </>
  );
}

function DoctorDetailPage() {
  const { doctorId } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const { data, error, loading } = useApiPage(`/api/doctors/${doctorId}`);
  const [slotDate, setSlotDate] = useState('');
  const [slotId, setSlotId] = useState('');
  const [mode, setMode] = useState('video');
  const [familyMemberId, setFamilyMemberId] = useState('');
  const [message, setMessage] = useState('');

  const availableByDate = useMemo(() => {
    const result = {};
    (data?.slots || [])
      .filter((slot) => slot.status === 'available')
      .forEach((slot) => {
        const date = new Date(slot.startAt).toISOString().slice(0, 10);
        if (!result[date]) result[date] = [];
        result[date].push(slot);
      });

    Object.keys(result).forEach((date) => {
      result[date].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    });

    return result;
  }, [data]);

  useEffect(() => {
    const dates = Object.keys(availableByDate).sort();
    if (!dates.length) return;
    if (!slotDate || !availableByDate[slotDate]) {
      setSlotDate(dates[0]);
      setSlotId(availableByDate[dates[0]][0]?.id || '');
      return;
    }
    const hasSlot = availableByDate[slotDate].some((slot) => slot.id === slotId);
    if (!hasSlot) {
      setSlotId(availableByDate[slotDate][0]?.id || '');
    }
  }, [availableByDate, slotDate, slotId]);

  const submitBooking = async (event) => {
    event.preventDefault();
    setMessage('');
    if (!slotId) {
      setMessage('Please select a slot.');
      return;
    }

    const res = await apiRequest('/api/appointments/book', {
      method: 'POST',
      body: {
        slotId,
        mode,
        familyMemberId
      }
    });

    if (!res.ok) {
      setMessage(res.data?.error || res.data?.message || 'Booking failed.');
      return;
    }

    if (res.data?.redirectTo) {
      navigate(res.data.redirectTo);
      return;
    }

    setMessage('Booked.');
  };

  if (loading) return <p className="muted">Loading doctor profile...</p>;
  if (error) return <p className="error">{error}</p>;

  const slotDates = Object.keys(availableByDate).sort();
  const selectedSlots = availableByDate[slotDate] || [];

  return (
    <>
      <section className="card">
        <h2>Dr. {data?.doctor?.fullName}</h2>
        <p className="muted">{data?.doctor?.doctorProfile?.specialization || 'General'} specialist</p>
        <p className="muted">{formatDoctorRating(data?.doctorRating?.average, data?.doctorRating?.count)}</p>
        <p className="muted">Trust score: {data?.trust?.score ?? 0} / 100</p>
        <p>{data?.doctor?.doctorProfile?.description || 'No description available.'}</p>
        <span className={`pill ${data?.doctorOnline ? 'online' : 'offline'}`}>
          {data?.doctorOnline ? 'online' : 'offline'}
        </span>
        {!data?.doctorOnline && data?.doctor?.doctorProfile?.statusMessage ? (
          <p className="muted">Offline note: {data.doctor.doctorProfile.statusMessage}</p>
        ) : null}
      </section>

      <section className="card">
        <h3>Book appointment</h3>
        {message ? <p className={message.toLowerCase().includes('failed') ? 'error' : 'success'}>{message}</p> : null}

        {user.role !== 'patient' ? <p className="muted">Only patient accounts can book appointments.</p> : null}

        {user.role === 'patient' ? (
          <form className="stack" onSubmit={submitBooking}>
            <label>
              Date
              <select value={slotDate} onChange={(e) => setSlotDate(e.target.value)}>
                {slotDates.length === 0 ? <option value="">No dates available</option> : null}
                {slotDates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Time slot
              <select value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                {selectedSlots.length === 0 ? <option value="">No slots</option> : null}
                {selectedSlots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {utcDateTime(slot.startAt)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="text">Text</option>
              </select>
            </label>

            <label>
              For
              <select value={familyMemberId} onChange={(e) => setFamilyMemberId(e.target.value)}>
                <option value="">Self ({user.fullName})</option>
                {(data?.familyMembers || []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                    {member.relationToPatient ? ` (${member.relationToPatient})` : ''}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit">Book now</button>
          </form>
        ) : null}
      </section>

      <section className="card">
        <h3>Recent patient feedback</h3>
        {(data?.recentReviews || []).length === 0 ? <p className="muted">No reviews yet for this doctor.</p> : null}
        {(data?.recentReviews || []).map((review) => (
          <article className="list-item" key={review.id}>
            <div>
              <strong>{review.rating} / 5</strong>
              <p className="muted">By {review.patient?.fullName || 'Patient'}</p>
              <p className="muted">{review.comment || 'No written feedback provided.'}</p>
            </div>
          </article>
        ))}
      </section>
    </>
  );
}

function AppointmentsPage() {
  const { user } = useSession();
  const { data, cacheMeta, error, loading } = useApiPage('/api/appointments');
  const upcoming = data?.upcomingAppointments || [];
  const past = data?.doneAppointments || [];

  useEffect(() => {
    if (!data) return;
    writeJsonStorage('cached_appointments', {
      data,
      cachedAt: Date.now()
    });
  }, [data]);

  return (
    <>
      <section className="journey-hero">
        <h2 className="journey-title">
          Your <span className="journey-accent">Visits</span>
        </h2>
        <p className="journey-sub">
          Stay connected with your care team. View your upcoming appointments or review your health history below.
        </p>
      </section>

      {loading ? <p className="muted">Loading appointments...</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {cacheMeta.fromCache ? (
        <p className="muted">📅 Showing saved appointments from {formatCachedAt(cacheMeta.cachedAt)}.</p>
      ) : null}

      <section className="journey-section">
        <div className="journey-section-head">
          <h3>Upcoming Visits</h3>
          <span className="journey-count-pill">{upcoming.length} Scheduled</span>
        </div>

        {upcoming.length === 0 ? <p className="journey-empty-note">No upcoming appointments.</p> : null}

        <div className="journey-appointment-stack">
          {upcoming.map((item) => (
            <article className="journey-appointment-card" key={item.id}>
              <div className="journey-appt-avatar-wrap">
                <div className="journey-appt-avatar">
                  {String(
                    user.role === 'doctor' ? item.patient?.fullName || 'P' : item.doctor?.fullName || 'D'
                  )
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
                <div className="journey-appt-mode">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {item.mode === 'video' ? 'video_camera_front' : item.mode === 'audio' ? 'call' : 'chat'}
                  </span>
                </div>
              </div>

              <div className="journey-appt-main">
                <span className="journey-specialty">{item.triage?.label || 'Planned consultation'}</span>
                <h4>{user.role === 'doctor' ? item.patient?.fullName : `Dr. ${item.doctor?.fullName}`}</h4>
                <div className="journey-appt-meta-row">
                  <span>
                    <span className="material-symbols-outlined" aria-hidden="true">calendar_today</span>
                    {formatPrettyDate(item.startAt)}
                  </span>
                  <span>
                    <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                    {formatPrettyTime(item.startAt)}
                  </span>
                </div>
                <p className="journey-meta">{item.mode} consultation</p>
              </div>

              <div className="journey-appt-actions">
                {user.role === 'doctor' ? (
                  <Link className="journey-cta" to={`/calls/${item.id}`}>
                    Join Call
                  </Link>
                ) : (
                  <Link className="journey-cta" to={`/appointments/${item.id}`}>
                    Open Visit
                  </Link>
                )}
                <Link className="journey-cta subtle" to={`/appointments/${item.id}`}>
                  Details
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="journey-section">
        <div className="journey-section-head">
          <h3>Past Visits</h3>
          <Link className="journey-link-chip" to="/appointments/impact">
            Impact Dashboard
          </Link>
        </div>

        {past.length === 0 ? <p className="journey-empty-note">No completed or cancelled consultations yet.</p> : null}

        <div className="journey-history-grid">
          {past.map((item) => (
            <article className="journey-history-card" key={item.id}>
              <div className="journey-history-head">
                <div className="journey-history-avatar">
                  {String(user.role === 'doctor' ? item.patient?.fullName || 'P' : item.doctor?.fullName || 'D')
                    .slice(0, 1)
                    .toUpperCase()}
                </div>
                <div>
                  <h4>{user.role === 'doctor' ? item.patient?.fullName : `Dr. ${item.doctor?.fullName}`}</h4>
                  <p>{`Visited ${formatPrettyDate(item.startAt)}`}</p>
                </div>
              </div>

              <p className="journey-meta">Status: {item.status}</p>
              {user.role === 'patient' && item.status === 'completed' ? (
                <p className="journey-meta">{item.review ? `Your review: ${item.review.rating} / 5` : 'Review pending'}</p>
              ) : null}

              <div className="journey-history-actions">
                {item.prescription ? (
                  <Link
                    className="journey-cta subtle"
                    to={buildPdfPreviewLink(
                      `/api/prescriptions/${item.id}/pdf`,
                      `Prescription ${item.id}`,
                      `/api/prescriptions/${item.id}/pdf?download=1`,
                      item.id
                    )}
                  >
                    View Prescription
                  </Link>
                ) : (
                  <Link className="journey-cta subtle" to={`/appointments/${item.id}`}>
                    Open Visit
                  </Link>
                )}

                {user.role === 'patient' ? (
                  <Link
                    className="journey-cta secondary"
                    to={
                      item.doctor?.id
                        ? `/book?doctorId=${item.doctor.id}&fromAppointmentId=${item.id}&rebook=1`
                        : `/book?fromAppointmentId=${item.id}&rebook=1`
                    }
                  >
                    Re-book
                  </Link>
                ) : (
                  <Link className="journey-cta secondary" to={`/appointments/${item.id}`}>
                    Open Details
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {user.role === 'patient' ? (
        <Link className="journey-fab" to="/book" aria-label="Book appointment">
          <span className="material-symbols-outlined" aria-hidden="true">add</span>
        </Link>
      ) : null}
    </>
  );
}

function ImpactPage() {
  const { user } = useSession();
  const { data, error, loading } = useApiPage('/api/appointments/impact');
  const metrics = data?.metrics;
  const adminInsights = metrics?.adminInsights;

  return (
    <>
      <section className="card row-between">
        <h2>Impact dashboard</h2>
        <Link className="btn subtle" to="/appointments">
          Back
        </Link>
      </section>

      {loading ? <p className="muted">Loading metrics...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {metrics ? (
        <section className="grid cards">
          <MetricCard label="Total consultations" value={metrics.total} />
          <MetricCard label="Completion rate" value={`${metrics.completionRate}%`} />
          <MetricCard label="Avg consult" value={`${metrics.avgConsultMins} min`} />
          <MetricCard label="Urgent triage" value={metrics.urgentCount} />
          <MetricCard label="Reminder due" value={metrics.reminderDueCount} />
          <MetricCard label="Follow-ups (14d)" value={metrics.followUpCount} />
        </section>
      ) : null}

      {user?.role === 'admin' && adminInsights ? (
        <>
          <section className="card">
            <h3>Admin operations panel</h3>
            <div className="grid cards">
              <MetricCard label="Unique patients reached" value={adminInsights.patientReach} />
              <MetricCard label="No-show rate" value={`${adminInsights.noShowRate}%`} />
              <MetricCard label="Urgent case rate" value={`${adminInsights.urgentRate}%`} />
              <MetricCard label="Video consults" value={adminInsights.modeCounts?.video || 0} />
              <MetricCard label="Audio consults" value={adminInsights.modeCounts?.audio || 0} />
              <MetricCard label="Text consults" value={adminInsights.modeCounts?.text || 0} />
            </div>
          </section>

          <section className="card">
            <h3>Impact outcomes</h3>
            <div className="grid cards">
              <MetricCard label="No-show cases" value={adminInsights.impactKpis?.noShowCases ?? 0} />
              <MetricCard label="No-show recovery" value={`${adminInsights.impactKpis?.noShowRecoveryRate ?? 0}%`} />
              <MetricCard label="Refill alerts (7d)" value={adminInsights.impactKpis?.refillAlertsNext7Days ?? 'N/A'} />
              <MetricCard
                label="Review coverage"
                value={
                  adminInsights.impactKpis?.reviewCoverageRate == null
                    ? 'N/A'
                    : `${adminInsights.impactKpis.reviewCoverageRate}%`
                }
              />
              <MetricCard label="Active helper links" value={adminInsights.impactKpis?.activeHelperLinks ?? 'N/A'} />
            </div>
          </section>

          <section className="grid cards">
            <article className="card metric">
              <p className="muted">Top doctors by consultation load</p>
              {(adminInsights.topDoctors || []).length === 0 ? (
                <p className="muted">No doctor activity yet.</p>
              ) : (
                <div className="metric-stack">
                  {adminInsights.topDoctors.map((doctor) => (
                    <p key={doctor.doctorId}>
                      <strong>{doctor.doctorName}</strong>
                      {' - '}
                      {doctor.total} visits, {doctor.completionRate}% completed, {doctor.noShow} no-shows
                    </p>
                  ))}
                </div>
              )}
            </article>

            <article className="card metric">
              <p className="muted">14-day volume trend</p>
              {(adminInsights.dailySeries || []).length === 0 ? (
                <p className="muted">No data in the last 14 days.</p>
              ) : (
                <div className="metric-stack">
                  {adminInsights.dailySeries.map((row) => (
                    <p key={row.day}>
                      <strong>{row.day}</strong>
                      {' - '}
                      {row.count} consult{row.count === 1 ? '' : 's'}
                    </p>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="grid cards">
            <article className="card metric">
              <p className="muted">Operational observability</p>
              <div className="metric-stack">
                <p>
                  <strong>Readiness:</strong> {adminInsights.operational?.readiness || 'unknown'}
                </p>
                <p>
                  <strong>DB status:</strong> {adminInsights.operational?.databaseStatus || 'unknown'}
                </p>
                <p>
                  <strong>DB latency:</strong> {adminInsights.operational?.dbLatencyMs ?? 'N/A'} ms
                </p>
                <p>
                  <strong>Reminder queue:</strong> {adminInsights.operational?.reminderQueueDepth ?? 'N/A'}
                </p>
                <p>
                  <strong>Failed reminders (24h):</strong> {adminInsights.operational?.failedReminders24h ?? 'N/A'}
                </p>
              </div>
            </article>

            <article className="card metric">
              <p className="muted">Mode quality KPIs</p>
              {(adminInsights.modeKpis || []).length === 0 ? (
                <p className="muted">No mode-level KPI data yet.</p>
              ) : (
                <div className="metric-stack">
                  {adminInsights.modeKpis.map((row) => (
                    <p key={row.mode}>
                      <strong>{row.mode.toUpperCase()}</strong>
                      {' - '}
                      {row.total} visits, {row.completionRate}% completed, {row.noShowRate}% no-show
                    </p>
                  ))}
                </div>
              )}
            </article>
          </section>

          <section className="card metric">
            <p className="muted">Clinical impact by region</p>
            {(adminInsights.regionKpis || []).length === 0 ? (
              <p className="muted">No region-level KPI data yet.</p>
            ) : (
              <div className="metric-stack">
                {adminInsights.regionKpis.map((row) => (
                  <p key={row.region}>
                    <strong>{row.region}</strong>
                    {' - '}
                    {row.total} visits, {row.completionRate}% completed, {row.urgentRate}% urgent
                  </p>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}

function MetricCard({ label, value }) {
  return (
    <article className="card metric">
      <p className="muted">{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

function AppointmentDetailPage() {
  const { appointmentId } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const { data, setData, error, loading, reload } = useApiPage(`/api/appointments/${appointmentId}`);
  const [uploadMessage, setUploadMessage] = useState('');
  const [preconsultMessage, setPreconsultMessage] = useState('');
  const [preconsultDraftMessage, setPreconsultDraftMessage] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [preconsult, setPreconsult] = useState({ problemDescription: '', medicationsText: '' });
  const [voiceNoteForm, setVoiceNoteForm] = useState({ transcriptText: '', summaryText: '' });
  const [voiceNoteMessage, setVoiceNoteMessage] = useState('');
  const [reviewForm, setReviewForm] = useState({ rating: '5', comment: '' });
  const [reviewMessage, setReviewMessage] = useState('');
  const preconsultDraftKey = `notes_${appointmentId}`;
  const prepChecklistKey = `prep_${appointmentId}`;
  const [prepChecklist, setPrepChecklist] = useState(() => {
    const fallback = {
      internetCheck: false,
      documentsReady: false,
      questionsReady: false,
      quietSpace: false
    };
    const stored = readJsonStorage(prepChecklistKey, fallback);
    return { ...fallback, ...(stored || {}) };
  });

  useEffect(() => {
    if (data?.appointment) {
      setPreconsult({
        problemDescription: data.appointment.problemDescription || '',
        medicationsText: data.appointment.medicationsText || ''
      });
      setReviewForm({
        rating: String(data.appointment.review?.rating || 5),
        comment: data.appointment.review?.comment || ''
      });
    }
  }, [data]);

  useEffect(() => {
    const cached = readJsonStorage(preconsultDraftKey, null);
    if (!cached?.problemDescription && !cached?.medicationsText) return;
    setPreconsult({
      problemDescription: cached.problemDescription || '',
      medicationsText: cached.medicationsText || ''
    });
    setPreconsultDraftMessage(`Saved on device at ${formatCachedAt(cached.cachedAt)}.`);
  }, [preconsultDraftKey]);

  useEffect(() => {
    writeJsonStorage(prepChecklistKey, prepChecklist);
  }, [prepChecklist, prepChecklistKey]);

  useEffect(() => {
    const appointment = data?.appointment;
    if (!appointment?.id) return undefined;
    if (user.role !== 'patient' || user.id !== appointment.patientId || appointment.status !== 'booked') {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      writeJsonStorage(preconsultDraftKey, {
        ...preconsult,
        cachedAt: Date.now()
      });
      setPreconsultDraftMessage('Saved on device');
    }, 900);

    return () => window.clearTimeout(timer);
  }, [data?.appointment, preconsult, preconsultDraftKey, user.id, user.role]);

  useEffect(() => {
    if (!data?.appointment?.id) return undefined;

    const tick = async () => {
      try {
        await apiRequest('/api/users/presence/ping', { method: 'POST' });
        const presenceRes = await apiRequest(`/api/appointments/${appointmentId}/presence`);
        if (presenceRes.ok && presenceRes.data?.ok) {
          setData((prev) => ({
            ...(prev || {}),
            presence: {
              doctorOnline: presenceRes.data.doctorOnline,
              patientOnline: presenceRes.data.patientOnline,
              canStartCall: presenceRes.data.canStartCall
            }
          }));
        }
      } catch (_err) {
        // keep silent; next tick retries
      }
    };

    tick();
    const timer = setInterval(tick, user.role === 'doctor' ? 15000 : 20000);

    return () => clearInterval(timer);
  }, [appointmentId, data?.appointment?.id, setData, user.role]);

  const postAction = async (path, body) => {
    const res = await apiRequest(path, { method: 'POST', body });
    if (!res.ok) {
      return { error: res.data?.error || res.data?.message || 'Action failed.' };
    }
    if (res.data?.redirectTo) {
      navigate(res.data.redirectTo);
      return { redirected: true };
    }
    if (res.data?.appointment) {
      setData(res.data);
    }
    return { ok: true, message: res.data?.message || '' };
  };

  const submitPreconsult = async (event) => {
    event.preventDefault();
    setPreconsultMessage('');
    const result = await postAction(`/api/appointments/${appointmentId}/prep`, preconsult);
    if (result.error) setPreconsultMessage(result.error);
    if (result.ok) {
      setPreconsultMessage('Pre-consult saved.');
      writeJsonStorage(preconsultDraftKey, null);
      try {
        window.localStorage.removeItem(preconsultDraftKey);
      } catch (_err) {}
      setPreconsultDraftMessage('Synced to server');
    }
  };

  const saveVoiceNote = async (event) => {
    event.preventDefault();
    setVoiceNoteMessage('');

    const transcriptText = String(voiceNoteForm.transcriptText || '').trim();
    if (!transcriptText) {
      setVoiceNoteMessage('Voice transcript is required.');
      return;
    }

    const res = await apiRequest(`/api/innovations/appointments/${appointmentId}/voice-notes`, {
      method: 'POST',
      body: {
        transcriptText,
        summaryText: voiceNoteForm.summaryText,
        language: user.language || 'en-IN'
      }
    });

    if (!res.ok) {
      setVoiceNoteMessage(res.data?.error || 'Could not save voice note.');
      return;
    }

    setVoiceNoteMessage('Voice note attached to this consultation.');
    setVoiceNoteForm({ transcriptText: '', summaryText: '' });
  };

  const runAction = async (path, successLabel, body) => {
    setActionMessage('');
    const result = await postAction(path, body);
    if (result.error) {
      setActionMessage(result.error);
      return;
    }
    if (result.ok && successLabel) {
      setActionMessage(result.message || successLabel);
    }
  };

  const submitReview = async (event) => {
    event.preventDefault();
    setReviewMessage('');
    const result = await postAction(`/api/appointments/${appointmentId}/review`, {
      rating: Number(reviewForm.rating),
      comment: reviewForm.comment
    });
    if (result.error) {
      setReviewMessage(result.error);
      return;
    }
    if (result.ok) {
      setReviewMessage('Review saved. Thank you for your feedback.');
    }
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const res = await apiRequest('/api/documents/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      setUploadMessage(res.data?.error || 'Upload failed.');
      return;
    }
    setUploadMessage('Uploaded.');
    reload();
  };

  if (loading) return <p className="muted">Loading appointment...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data?.appointment) return <p className="error">Appointment not found.</p>;

  const appointment = data.appointment;
  const patientView = user.role === 'patient' && user.id === appointment.patientId;
  const canReview =
    user.role === 'patient' && appointment.status === 'completed' && user.id === appointment.patientId;
  const canMarkNoShow = user.role === 'doctor' || user.role === 'admin';
  const personName =
    data.history?.currentPatientProfile?.name ||
    (appointment.familyMember ? appointment.familyMember.fullName : appointment.patient.fullName);
  const modeLabel =
    appointment.mode === 'video' ? 'Video Call' : appointment.mode === 'audio' ? 'Audio Call' : 'Text Consultation';
  const historyEntries = data.history?.historyAppointments || [];
  const minutesUntilStart = Math.round((new Date(appointment.startAt).getTime() - Date.now()) / 60000);
  const showPrepChecklist = appointment.status === 'booked' && minutesUntilStart <= 30 && minutesUntilStart >= -15;
  const rebookShortcut =
    data.rebookShortcut || `/book?doctorId=${encodeURIComponent(appointment.doctorId)}&fromAppointmentId=${encodeURIComponent(appointment.id)}&rebook=1`;

  if (patientView) {
    return (
      <section className="patient-appointment-shell">
        <header className="patient-appointment-topbar">
          <div className="patient-appointment-brand">
            <Link className="patient-appointment-back" to="/appointments" aria-label="Back to appointments">
              <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
            </Link>
            <strong>Appointment Detail</strong>
          </div>
          <div className="patient-appointment-tools">
            <span className="patient-appointment-avatar">
              {String(user.fullName || 'P').slice(0, 1).toUpperCase()}
            </span>
          </div>
        </header>

        <div className="patient-appointment-main">
          <aside className="patient-appointment-left">
            <section className="patient-appointment-summary">
              <p className="patient-appointment-kicker">Scheduled For</p>
              <span className="patient-appointment-status">{appointment.status}</span>
              <h1>{formatPrettyDate(appointment.startAt)} â€¢ {formatPrettyTime(appointment.startAt)} UTC</h1>
              <p>Consultation for {personName}</p>
              <p className="patient-summary-type">General consultation â€¢ {modeLabel}</p>
            </section>

            <section className="patient-appointment-action-card">
              <div className="patient-mobile-primary-actions">
                {data.presence?.canStartCall ? (
                  <Link className="patient-appointment-cta primary" to={`/calls/${appointment.id}`}>
                    <span className="material-symbols-outlined" aria-hidden="true">videocam</span>
                    Join Session
                  </Link>
                ) : (
                  <button className="patient-appointment-cta locked primary" type="button" disabled>
                    <span className="material-symbols-outlined" aria-hidden="true">lock</span>
                    Session Locked
                  </button>
                )}

                <button className="patient-appointment-emergency-btn" type="button" aria-label="Emergency support">
                  <span className="material-symbols-outlined" aria-hidden="true">emergency</span>
                </button>
              </div>

              <div className="patient-appointment-mode">
                <span className="material-symbols-outlined" aria-hidden="true">
                  {appointment.mode === 'video' ? 'videocam' : appointment.mode === 'audio' ? 'call' : 'chat'}
                </span>
                <div>
                  <small>Consultation Mode</small>
                  <strong>{modeLabel}</strong>
                </div>
              </div>

              <Link className="patient-appointment-cta secondary" to={`/prescriptions/${appointment.id}`}>
                <span className="material-symbols-outlined" aria-hidden="true">description</span>
                Prescription
              </Link>

              <Link className="patient-appointment-cta secondary" to={`/ai-copilot?appointmentId=${appointment.id}`}>
                <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                AI Copilot
              </Link>

              <div className="patient-appointment-action-grid">
                <button
                  type="button"
                  className="patient-appointment-text-btn danger"
                  disabled={appointment.status !== 'booked'}
                  onClick={() => runAction(`/api/appointments/${appointment.id}/cancel`, 'Appointment cancelled.')}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">cancel</span>
                  Cancel
                </button>
                <button
                  type="button"
                  className="patient-appointment-text-btn"
                  disabled={appointment.status === 'completed' || appointment.status === 'cancelled'}
                  onClick={() => runAction(`/api/appointments/${appointment.id}/end`, 'Appointment closed.')}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                  Close
                </button>
              </div>

              {appointment.status === 'completed' || appointment.status === 'cancelled' || appointment.status === 'no_show' ? (
                <Link className="patient-appointment-cta secondary" to={rebookShortcut}>
                  <span className="material-symbols-outlined" aria-hidden="true">history</span>
                  Re-book this doctor
                </Link>
              ) : null}

              {actionMessage ? <p className="muted">{actionMessage}</p> : null}
            </section>

            <section className="patient-appointment-participants">
              <h3>Participants</h3>
              <div className="patient-participant-row">
                <div className="patient-participant-main">
                  <span className="patient-participant-photo">
                    {String(appointment.doctor.fullName || 'D').slice(0, 1).toUpperCase()}
                    <span className={`patient-participant-dot ${data.presence?.doctorOnline ? 'online' : 'offline'}`} />
                  </span>
                  <div>
                    <strong>Dr. {appointment.doctor.fullName}</strong>
                    <p>{data.presence?.doctorOnline ? 'Online' : 'Offline'}</p>
                  </div>
                </div>
              </div>
              <div className="patient-participant-row">
                <div className="patient-participant-main">
                  <span className="patient-participant-photo">
                    {String(personName || 'P').slice(0, 1).toUpperCase()}
                    <span className={`patient-participant-dot ${data.presence?.patientOnline ? 'online' : 'offline'}`} />
                  </span>
                  <div>
                    <strong>{personName}</strong>
                    <p>{data.presence?.patientOnline ? 'Online' : 'Offline'}</p>
                  </div>
                </div>
              </div>
            </section>
          </aside>

          <div className="patient-appointment-right">
            {(data.error || data.message) ? (
              <section className="patient-inline-state">
                {data.error ? <p className="error">{data.error}</p> : null}
                {data.message ? <p className="success">{data.message}</p> : null}
              </section>
            ) : null}

            <section className="patient-info-card">
              <div className="patient-section-head">
                <span className="material-symbols-outlined" aria-hidden="true">history_edu</span>
                <h2>Medical Context</h2>
              </div>

              <div className="patient-history-overview">
                <article>
                  <small>Chronic Conditions</small>
                  <p>{data.history?.currentPatientProfile?.chronicConditions || 'N/A'}</p>
                </article>
                <article>
                  <small>Basic Health Info</small>
                  <p>{data.history?.currentPatientProfile?.basicHealthInfo || 'N/A'}</p>
                </article>
              </div>

              <div className="patient-history-grid">
                {(data.history?.historyAppointments || []).slice(0, 4).map((entry) => (
                  <article key={entry.id}>
                    <div className="patient-history-row-head">
                      <strong>{formatPrettyDate(entry.startAt)}</strong>
                      <span>{formatPrettyTime(entry.startAt)} UTC</span>
                    </div>
                    <p>{entry.prescription?.diagnosis || 'No prescription'}</p>
                  </article>
                ))}
                {(data.history?.historyAppointments || []).length === 0 ? (
                  <p className="muted">No previous consultations.</p>
                ) : null}
              </div>
            </section>

            <section className="patient-info-card soft">
              <div className="patient-section-head">
                <span className="material-symbols-outlined" aria-hidden="true">edit_note</span>
                <h2>Consultation Notes</h2>
              </div>

              {appointment.status === 'booked' ? (
                <form className="patient-form-stack" onSubmit={submitPreconsult}>
                  <label>
                    Symptoms and concerns
                    <textarea
                      value={preconsult.problemDescription}
                      onChange={(e) => setPreconsult((prev) => ({ ...prev, problemDescription: e.target.value }))}
                      placeholder={`Describe how ${personName} is feeling...`}
                    />
                  </label>
                  <label>
                    Current medicines
                    <textarea
                      value={preconsult.medicationsText}
                      onChange={(e) => setPreconsult((prev) => ({ ...prev, medicationsText: e.target.value }))}
                      placeholder="List any medications currently being taken..."
                    />
                  </label>
                  <button className="patient-form-submit" type="submit">Save pre-consult</button>
                  {preconsultMessage ? <p className="muted">{preconsultMessage}</p> : null}
                  {preconsultDraftMessage ? <p className="muted">{preconsultDraftMessage}</p> : null}
                </form>
              ) : (
                <div className="panel-soft">
                  <p>{appointment.problemDescription || 'No symptoms submitted.'}</p>
                  <p>{appointment.medicationsText || 'No medicines submitted.'}</p>
                </div>
              )}
            </section>

            {showPrepChecklist ? (
              <section className="patient-info-card prep-checklist-card">
                <div className="patient-section-head">
                  <span className="material-symbols-outlined" aria-hidden="true">checklist</span>
                  <h2>30-minute prep checklist</h2>
                </div>
                <p className="muted">
                  Session starts in {minutesUntilStart} minutes. Complete this quick checklist for a smooth consult.
                </p>
                <label className="prep-checklist-row">
                  <input
                    type="checkbox"
                    checked={prepChecklist.internetCheck}
                    onChange={(event) =>
                      setPrepChecklist((prev) => ({ ...prev, internetCheck: event.target.checked }))
                    }
                  />
                  Device and internet are stable.
                </label>
                <label className="prep-checklist-row">
                  <input
                    type="checkbox"
                    checked={prepChecklist.documentsReady}
                    onChange={(event) =>
                      setPrepChecklist((prev) => ({ ...prev, documentsReady: event.target.checked }))
                    }
                  />
                  Previous reports and medicines are ready.
                </label>
                <label className="prep-checklist-row">
                  <input
                    type="checkbox"
                    checked={prepChecklist.questionsReady}
                    onChange={(event) =>
                      setPrepChecklist((prev) => ({ ...prev, questionsReady: event.target.checked }))
                    }
                  />
                  Questions and symptom notes are prepared.
                </label>
                <label className="prep-checklist-row">
                  <input
                    type="checkbox"
                    checked={prepChecklist.quietSpace}
                    onChange={(event) =>
                      setPrepChecklist((prev) => ({ ...prev, quietSpace: event.target.checked }))
                    }
                  />
                  Quiet, private space is ready for the consult.
                </label>
              </section>
            ) : null}

            <section className="patient-info-card">
              <div className="patient-section-head">
                <span className="material-symbols-outlined" aria-hidden="true">upload_file</span>
                <h2>Health Vault</h2>
              </div>

              {appointment.status === 'booked' ? (
                <form className="patient-upload-grid" onSubmit={handleUpload}>
                  <input type="hidden" name="appointmentId" value={appointment.id} />
                  <label>
                    Upload for
                    <select name="uploadFor" defaultValue={appointment.familyMemberId || 'user'}>
                      <option value="user">{appointment.patient.fullName}</option>
                      {(data.familyMembers || []).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.fullName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Select File
                    <input type="file" name="file" required />
                  </label>
                  <button className="patient-form-submit" type="submit">
                    <span className="material-symbols-outlined" aria-hidden="true">cloud_upload</span>
                    Upload
                  </button>
                </form>
              ) : null}

              {uploadMessage ? <p className="muted">{uploadMessage}</p> : null}

              <div className="patient-doc-list">
                {(appointment.documents || []).length === 0 ? <p className="muted">No documents attached.</p> : null}
                {(appointment.documents || []).map((doc) => (
                  <article className="patient-doc-item" key={doc.id}>
                    <div>
                      <strong>{doc.fileName}</strong>
                      <p>{Math.round(doc.sizeBytes / 1024)} KB</p>
                    </div>
                    {isPdfContentType(doc.contentType) ? (
                      <Link
                        to={buildPdfPreviewLink(
                          `/api/documents/${doc.id}/preview`,
                          doc.fileName,
                          `/api/documents/${doc.id}/download`
                        )}
                      >
                        Preview PDF
                      </Link>
                    ) : (
                      <a href={`/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
                        Download
                      </a>
                    )}
                  </article>
                ))}
              </div>
            </section>

            {canReview ? (
              <section className="patient-info-card">
                <div className="patient-section-head">
                  <span className="material-symbols-outlined" aria-hidden="true">star</span>
                  <h2>Rate your doctor</h2>
                </div>
                <form className="patient-form-stack" onSubmit={submitReview}>
                  <label>
                    Rating
                    <select value={reviewForm.rating} onChange={(e) => setReviewForm((prev) => ({ ...prev, rating: e.target.value }))}>
                      <option value="5">5 - Excellent</option>
                      <option value="4">4 - Very good</option>
                      <option value="3">3 - Good</option>
                      <option value="2">2 - Fair</option>
                      <option value="1">1 - Poor</option>
                    </select>
                  </label>
                  <label>
                    Comment
                    <textarea
                      value={reviewForm.comment}
                      onChange={(e) => setReviewForm((prev) => ({ ...prev, comment: e.target.value }))}
                      placeholder="Share your experience with this consultation"
                    />
                  </label>
                  <button className="patient-form-submit" type="submit">Save review</button>
                </form>
                {reviewMessage ? <p className="muted">{reviewMessage}</p> : null}
              </section>
            ) : null}
          </div>
        </div>

        <nav className="patient-appointment-mobile-nav" aria-label="Patient quick navigation">
          <Link to="/dashboard">
            <span className="material-symbols-outlined" aria-hidden="true">home_health</span>
            <span>Home</span>
          </Link>
          <Link className="active" to="/appointments">
            <span className="material-symbols-outlined" aria-hidden="true">event_available</span>
            <span>Booking</span>
          </Link>
          <Link to={`/ai-copilot?appointmentId=${appointment.id}`}>
            <span className="material-symbols-outlined" aria-hidden="true">smart_toy</span>
            <span>Copilot</span>
          </Link>
          <Link to="/ai-copilot">
            <span className="material-symbols-outlined" aria-hidden="true">support_agent</span>
            <span>AI Help</span>
          </Link>
        </nav>
      </section>
    );
  }

  return (
    <section className="doctor-appointment-shell">
      <header className="doctor-appointment-topbar">
        <div className="doctor-appointment-brand">Digital Sanctuary</div>
        <nav className="doctor-appointment-nav" aria-label="Consultation navigation">
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/appointments" className="active">Consultations</Link>
        </nav>
        <div className="doctor-appointment-top-actions">
          <button type="button" className="doctor-appointment-icon-btn" aria-label="Notifications">
            <span className="material-symbols-outlined" aria-hidden="true">notifications</span>
          </button>
          <button type="button" className="doctor-appointment-icon-btn" aria-label="Settings">
            <span className="material-symbols-outlined" aria-hidden="true">settings</span>
          </button>
          <span className="doctor-appointment-avatar">{String(user.fullName || 'D').slice(0, 1).toUpperCase()}</span>
        </div>
      </header>

      <div className="doctor-appointment-content">
        <aside className="doctor-appointment-sidebar">
          <section className="doctor-appointment-patient-card">
            <div className="doctor-appointment-patient-head">
              <span className="doctor-appointment-patient-avatar">{String(personName || 'P').slice(0, 1).toUpperCase()}</span>
              <div>
                <h3>{personName}</h3>
                <p>ID: {String(appointment.id).slice(0, 8).toUpperCase()}</p>
              </div>
            </div>

            {data.presence?.canStartCall ? (
              <Link className="doctor-appointment-start-btn" to={`/calls/${appointment.id}`}>
                <span className="material-symbols-outlined" aria-hidden="true">video_call</span>
                Start Consultation
              </Link>
            ) : (
              <button className="doctor-appointment-start-btn locked" type="button" disabled>
                <span className="material-symbols-outlined" aria-hidden="true">lock</span>
                Call Locked
              </button>
            )}
          </section>

          <nav className="doctor-appointment-side-nav" aria-label="Detail sections">
            <a href="#overview" className="active">
              <span className="material-symbols-outlined" aria-hidden="true">clinical_notes</span>
              Overview
            </a>
            <a href="#history">
              <span className="material-symbols-outlined" aria-hidden="true">history</span>
              Medical History
            </a>
            <a href="#documents">
              <span className="material-symbols-outlined" aria-hidden="true">description</span>
              Documents
            </a>
          </nav>
        </aside>

        <div className="doctor-appointment-main">
          <header className="doctor-appointment-hero" id="overview">
            <div>
              <span className="doctor-appointment-kicker">Ongoing Journey</span>
              <h1>Consultation with {personName}</h1>
              <div className="doctor-appointment-meta-chips">
                <span>
                  <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
                  {utcDateTime(appointment.startAt)}
                </span>
                <span className="status">
                  <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                  Status: {appointment.status}
                </span>
                <span>
                  <span className="material-symbols-outlined" aria-hidden="true">videocam</span>
                  Mode: {modeLabel}
                </span>
              </div>
            </div>

            <div className="doctor-appointment-actions">
              {data.presence?.canStartCall ? (
                <Link className="doctor-appointment-action-main" to={`/calls/${appointment.id}`}>
                  <span className="material-symbols-outlined" aria-hidden="true">video_call</span>
                  Join Call
                </Link>
              ) : (
                <button className="doctor-appointment-action-main locked" type="button" disabled>
                  <span className="material-symbols-outlined" aria-hidden="true">lock</span>
                  Call Locked
                </button>
              )}

              <div className="doctor-appointment-action-grid">
                <Link className="doctor-appointment-sub-btn" to={`/prescriptions/${appointment.id}`}>
                  Prescription
                </Link>
                <Link className="doctor-appointment-sub-btn" to={`/ai-copilot?appointmentId=${appointment.id}`}>
                  AI Copilot
                </Link>
                <button
                  type="button"
                  className="doctor-appointment-sub-btn danger"
                  disabled={appointment.status !== 'booked'}
                  onClick={() => runAction(`/api/appointments/${appointment.id}/cancel`, 'Appointment cancelled.')}
                >
                  Cancel
                </button>
                {canMarkNoShow ? (
                  <button
                    type="button"
                    className="doctor-appointment-sub-btn"
                    disabled={appointment.status !== 'booked'}
                    onClick={() =>
                      runAction(
                        `/api/appointments/${appointment.id}/no-show-followup`,
                        'Appointment marked no-show and follow-up drafted.'
                      )
                    }
                  >
                    Mark No-show + Follow-up
                  </button>
                ) : null}
              </div>

              {appointment.status !== 'completed' && appointment.status !== 'cancelled' ? (
                <button
                  type="button"
                  className="doctor-appointment-sub-btn subtle"
                  onClick={() => runAction(`/api/appointments/${appointment.id}/end`, 'Appointment closed.')}
                >
                  Close Appointment
                </button>
              ) : null}
            </div>
          </header>

          {(data.error || data.message || actionMessage) ? (
            <section className="doctor-appointment-flash">
              {data.error ? <p className="error">{data.error}</p> : null}
              {data.message ? <p className="success">{data.message}</p> : null}
              {actionMessage ? <p className="muted">{actionMessage}</p> : null}
            </section>
          ) : null}

          <div className="doctor-appointment-grid">
            <div className="doctor-appointment-left-col">
              <section className="doctor-appointment-participants">
                <h2>
                  <span className="material-symbols-outlined" aria-hidden="true">groups</span>
                  Participants
                </h2>

                <article className="doctor-appointment-participant-row">
                  <span className="avatar">{String(appointment.doctor.fullName || 'D').slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>Dr. {appointment.doctor.fullName}</strong>
                    <p>{data.presence?.doctorOnline ? 'Online' : 'Offline'}</p>
                  </div>
                </article>

                <article className="doctor-appointment-participant-row">
                  <span className="avatar">{String(personName || 'P').slice(0, 1).toUpperCase()}</span>
                  <div>
                    <strong>{personName}</strong>
                    <p>{data.presence?.patientOnline ? 'Online' : 'Offline'}</p>
                  </div>
                </article>
              </section>

              <section className="doctor-appointment-prep">
                <h2>Pre-consultation Notes</h2>
                <article>
                  <small>Patient Symptoms</small>
                  <p>{appointment.problemDescription || 'No symptoms submitted.'}</p>
                </article>
                <article>
                  <small>Current Medicines</small>
                  <p>{appointment.medicationsText || 'No medicines submitted.'}</p>
                </article>
                {showPrepChecklist ? (
                  <article>
                    <small>Session prep window</small>
                    <p>Consultation starts in {minutesUntilStart} minutes. Confirm patient documents and connectivity.</p>
                  </article>
                ) : null}
                {preconsultMessage ? <p className="muted">{preconsultMessage}</p> : null}
              </section>

              <section className="doctor-appointment-docs" id="documents">
                <h2>Documents</h2>
                {(appointment.documents || []).length === 0 ? <p className="muted">No documents attached.</p> : null}
                {(appointment.documents || []).map((doc) => (
                  <article key={doc.id} className="doctor-appointment-doc-row">
                    <div>
                      <strong>{doc.fileName}</strong>
                      <p>{Math.round(doc.sizeBytes / 1024)} KB</p>
                    </div>
                    {isPdfContentType(doc.contentType) ? (
                      <Link
                        to={buildPdfPreviewLink(
                          `/api/documents/${doc.id}/preview`,
                          doc.fileName,
                          `/api/documents/${doc.id}/download`
                        )}
                      >
                        Preview PDF
                      </Link>
                    ) : (
                      <a href={`/documents/${doc.id}/download`} target="_blank" rel="noreferrer">
                        Download
                      </a>
                    )}
                  </article>
                ))}
              </section>

              <section className="doctor-appointment-docs">
                <h2>Voice Notes for Low Literacy</h2>
                <p className="muted">Record a plain-language summary in the patient's language and attach it to this appointment.</p>
                <form className="stack" onSubmit={saveVoiceNote}>
                  <label>
                    Transcript
                    <textarea
                      value={voiceNoteForm.transcriptText}
                      onChange={(event) => setVoiceNoteForm((prev) => ({ ...prev, transcriptText: event.target.value }))}
                      rows={3}
                      required
                    />
                  </label>
                  <label>
                    Simplified summary (optional)
                    <textarea
                      value={voiceNoteForm.summaryText}
                      onChange={(event) => setVoiceNoteForm((prev) => ({ ...prev, summaryText: event.target.value }))}
                      rows={2}
                    />
                  </label>
                  <button type="submit">Save Voice Note</button>
                </form>
                {voiceNoteMessage ? <p className="muted">{voiceNoteMessage}</p> : null}
              </section>
            </div>

            <section className="doctor-appointment-history" id="history">
              <div className="doctor-appointment-history-head">
                <h2>Medical History</h2>
                <span>{historyEntries.length} Records Found</span>
              </div>

              <div className="doctor-appointment-history-list">
                {historyEntries.length === 0 ? <p className="muted">No previous consultations.</p> : null}
                {historyEntries.map((entry) => {
                  const diagnosis = entry.prescription?.diagnosis || 'No prescription issued.';
                  const tone = /critical|severe|urgent|emergency/i.test(diagnosis)
                    ? 'critical'
                    : /fever|infection|pain|symptom/i.test(diagnosis)
                      ? 'alert'
                      : 'default';

                  return (
                    <article className={`doctor-history-item ${tone}`} key={entry.id}>
                      <div className="icon">
                        <span className="material-symbols-outlined" aria-hidden="true">
                          {tone === 'critical' ? 'emergency' : tone === 'alert' ? 'thermometer' : 'clinical_notes'}
                        </span>
                      </div>
                      <div className="content">
                        <div className="row">
                          <strong>{entry.prescription?.diagnosis || 'Consultation recap'}</strong>
                          <time>{utcDateTime(entry.startAt)}</time>
                        </div>
                        <p>{diagnosis}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function CallPage() {
  const { appointmentId } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();
  const { data, error, loading } = useApiPage(`/api/calls/${appointmentId}`);
  const callScriptRef = useRef(null);

  useEffect(() => {
    if (!data?.callConfigEncoded) return undefined;

    const supabaseScript = document.createElement('script');
    supabaseScript.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    supabaseScript.async = false;

    const runtimeScript = document.createElement('script');
    runtimeScript.src = `/js/call.js?v=${Date.now()}`;
    runtimeScript.async = false;

    supabaseScript.onload = () => {
      document.body.appendChild(runtimeScript);
      callScriptRef.current = runtimeScript;
    };

    document.body.appendChild(supabaseScript);

    return () => {
      if (supabaseScript.parentNode) supabaseScript.parentNode.removeChild(supabaseScript);
      if (runtimeScript.parentNode) runtimeScript.parentNode.removeChild(runtimeScript);
    };
  }, [data?.callConfigEncoded]);

  const endCall = async () => {
    const res = await apiRequest(`/api/calls/${appointmentId}/end`, { method: 'POST' });
    if (res.data?.redirectTo) {
      navigate(res.data.redirectTo);
      return;
    }
    navigate(`/appointments/${appointmentId}`);
  };

  if (loading) return <p className="muted">Preparing your consultation room...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data?.appointment) return <p className="error">Call not available.</p>;

  const appointment = data.appointment;
  const doctorName = appointment.doctor?.fullName ? `Dr. ${appointment.doctor.fullName}` : 'Doctor';
  const patientName = appointment.familyMember?.fullName || appointment.patient?.fullName || 'Patient';
  const modeText = appointment.mode === 'video' ? 'Video' : appointment.mode === 'audio' ? 'Audio' : 'Text';

  return (
    <section className="call-sanctuary-shell">
      <header className="call-sanctuary-top">
        <div className="call-top-left">
          <strong>Digital Sanctuary</strong>
          <div className="call-top-meta">
            <span>Live consultation in progress</span>
            <small>ID: {appointment.id}</small>
          </div>
        </div>

        <div className="call-top-right">
          <span className="call-mode-chip">
            <span className="material-symbols-outlined" aria-hidden="true">videocam</span>
            Mode: {modeText}
          </span>
          <span id="status" className="call-status-chip">idle</span>
        </div>
      </header>

      <main className="call-sanctuary-main">
        <div className="call-safety-tip" role="status">
          <span className="material-symbols-outlined" aria-hidden="true">network_check</span>
          <p>If your network drops, stay on this screen. The session will reconnect automatically when possible.</p>
        </div>

        <section className="call-video-stage">
          <video id="remoteVideo" autoPlay playsInline />

          <div className="call-identity-badge">
            <span className={`dot ${(data.presence?.doctorOnline || data.presence?.patientOnline) ? 'online' : ''}`} />
            <span>{user.role === 'doctor' ? patientName : doctorName}</span>
          </div>

          <div className="call-local-wrap">
            <video id="localVideo" autoPlay muted playsInline className="local-preview" />
            <small>You</small>
          </div>
        </section>
      </main>

      <aside className="call-sidebar" aria-label="Visit details and chat">
        <div className="call-sidebar-head">
          <h2>Visit Details</h2>
          <p>Secure connection</p>
        </div>

        <div className="call-chat-note">
          Use this panel if voice is unclear due to low network quality.
        </div>

        <div className="call-chat-tools" aria-label="Chat translation controls">
          <label htmlFor="chatLanguage">Chat translation language</label>
          <div className="call-chat-tools-row">
            <select id="chatLanguage" defaultValue={user.language || 'English'}>
              <option value="English">English</option>
              <option value="Hindi">Hindi</option>
              <option value="Bengali">Bengali</option>
              <option value="Tamil">Tamil</option>
              <option value="Telugu">Telugu</option>
              <option value="Marathi">Marathi</option>
              <option value="Gujarati">Gujarati</option>
              <option value="Kannada">Kannada</option>
              <option value="Malayalam">Malayalam</option>
              <option value="Urdu">Urdu</option>
            </select>
            <button id="btnTranslateToggle" type="button" className="call-control-btn compact">
              <span className="material-symbols-outlined" aria-hidden="true">translate</span>
              <span data-label>Translate: Off</span>
            </button>
          </div>
          <p className="muted">When enabled, incoming and outgoing chat messages are translated to your selected language.</p>
          <Link className="call-ai-link" to={`/ai-copilot?appointmentId=${appointment.id}`}>
            Open full AI Copilot workspace
          </Link>
        </div>

        <div id="chatLog" className="chat-log call-chat-log" />

        <form id="chatForm" className="call-chat-form">
          <input id="chatInput" placeholder="Type a message..." />
          <button type="submit" aria-label="Send chat message">
            <span className="material-symbols-outlined" aria-hidden="true">send</span>
          </button>
        </form>
      </aside>

      <nav className="call-controls" aria-label="Call controls">
        <div className="call-controls-group primary">
          <button id="btnMute" className="call-control-btn" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">mic</span>
            <span data-label>Mute</span>
          </button>
          <button id="btnVideo" className="call-control-btn active" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">videocam</span>
            <span>Video</span>
          </button>
          <button id="btnAudio" className="call-control-btn" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">volume_up</span>
            <span>Audio</span>
          </button>
          <button id="btnText" className="call-control-btn" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">chat_bubble</span>
            <span>Text</span>
          </button>
          <button id="btnDataQuality" className="call-control-btn" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">network_check</span>
            <span data-label>Quality: Auto</span>
          </button>
          <button id="btnCamera" className="call-control-btn" type="button">
            <span className="material-symbols-outlined" aria-hidden="true">photo_camera</span>
            <span data-label>Camera</span>
          </button>
        </div>

        <button className="call-end-btn" type="button" onClick={endCall}>
          <span className="material-symbols-outlined" aria-hidden="true">call_end</span>
          End Call
        </button>
      </nav>

      <div id="callRuntimeConfig" data-call-config={data.callConfigEncoded} />
    </section>
  );
}

function PrescriptionPage() {
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const { data, setData, cacheMeta, error, loading } = useApiPage(`/api/prescriptions/${appointmentId}`);
  const [message, setMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('Show to Pharmacist');
  const [aiBusy, setAiBusy] = useState(false);
  const [simplifiedPrescription, setSimplifiedPrescription] = useState('');
  const [smartReminder, setSmartReminder] = useState('');
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioMessage, setAudioMessage] = useState('');
  const [narrationText, setNarrationText] = useState('');
  const [narrationLanguage, setNarrationLanguage] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [rows, setRows] = useState([{ medicationName: '', dosage: '', frequency: '', duration: '', sideEffects: '' }]);
  const [form, setForm] = useState({
    diagnosis: '',
    instructions: '',
    followUpAt: '',
    pharmacyName: '',
    pharmacyContact: '',
    notes: ''
  });
  const speechSupported = useMemo(
    () => typeof window !== 'undefined' && Boolean(window.speechSynthesis) && Boolean(window.SpeechSynthesisUtterance),
    []
  );

  useEffect(() => {
    const prescription = data?.appointment?.prescription;
    if (!prescription) return;

    const rowItems = Array.isArray(prescription.items) && prescription.items.length > 0
      ? prescription.items.map((item) => ({
          medicationName: item.name || '',
          dosage: item.dosage || '',
          frequency: item.frequency || '',
          duration: item.duration || '',
          sideEffects: formatSideEffectsText(item.sideEffects)
        }))
      : [{ medicationName: '', dosage: '', frequency: '', duration: '', sideEffects: '' }];

    setRows(rowItems);
    setForm({
      diagnosis: prescription.diagnosis || '',
      instructions: prescription.instructions || '',
      followUpAt: prescription.followUpAt ? new Date(prescription.followUpAt).toISOString().slice(0, 10) : '',
      pharmacyName: data.handoff?.pharmacyName || '',
      pharmacyContact: data.handoff?.pharmacyContact || '',
      notes: prescription.notes || ''
    });
  }, [data]);

  useEffect(() => {
    if (!data) return;
    writeJsonStorage('cached_prescriptions', {
      data,
      cachedAt: Date.now()
    });
  }, [data]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    setNarrationText('');
    setNarrationLanguage('');
    setAudioMessage('');
    setIsPlayingAudio(false);
  }, [appointmentId]);

  const isDoctorOwner =
    user.role === 'doctor' && data?.appointment && user.id === data.appointment.doctorId;

  const savePrescription = async (event) => {
    event.preventDefault();
    setMessage('');

    const payload = {
      ...form,
      medicationName: rows.map((row) => row.medicationName),
      dosage: rows.map((row) => row.dosage),
      frequency: rows.map((row) => row.frequency),
      duration: rows.map((row) => row.duration),
      sideEffects: rows.map((row) => row.sideEffects)
    };

    const res = await apiRequest(`/api/prescriptions/${appointmentId}`, {
      method: 'POST',
      body: payload
    });

    if (!res.ok) {
      setMessage(res.data?.error || res.data?.message || 'Unable to save prescription.');
      return;
    }

    if (res.data?.appointment) {
      setData(res.data);
    }

    navigate(`/appointments/${appointmentId}`, { replace: true });
  };

  const copyHandoffCode = async () => {
    try {
      await navigator.clipboard.writeText(data?.handoffCode || '');
      setCopyMessage('Code copied');
    } catch (_err) {
      setCopyMessage('Copy unavailable');
    }

    window.setTimeout(() => setCopyMessage('Show to Pharmacist'), 1800);
  };

  const generatePatientFriendlyText = async () => {
    if (!data?.appointment?.id || !data?.appointment?.prescription) return;
    setAiBusy(true);
    setMessage('');

    try {
      const preferredLanguage = getAppSelectedLanguage(user.language || data.appointment.patient?.language || 'English');
      const preferredLanguageName = resolvePreferredLanguageName(preferredLanguage);

      const localizedScriptText = buildPrescriptionNarrationTextLocalized({
        language: preferredLanguageName,
        patientName: data.appointment.familyMember?.fullName || data.appointment.patient?.fullName || '',
        doctorName: `Dr. ${data.appointment.doctor?.fullName || 'your doctor'}`,
        diagnosis: data.appointment.prescription?.diagnosis || '',
        items: data.appointment.prescription?.items || [],
        instructions: data.appointment.prescription?.instructions || '',
        followUpAt: data.appointment.prescription?.followUpAt || null
      });

      const localizedText = await ensureNarrationLanguage({
        appointmentId: data.appointment.id,
        targetLanguage: preferredLanguageName,
        preferredText: localizedScriptText,
        fallbackText: localizedScriptText
      });

      const plainLanguageText = localizedText || 'No simplified text returned.';
      setSimplifiedPrescription(plainLanguageText);
      setNarrationText(stripHandoffCodeFromNarration(plainLanguageText));
      setNarrationLanguage(preferredLanguageName);
    } catch (_err) {
      setMessage('Unable to generate prescription summary right now.');
    } finally {
      setAiBusy(false);
    }
  };

  const generateReminderMessage = async () => {
    if (!data?.appointment?.id) return;
    setAiBusy(true);
    setMessage('');

    const res = await apiRequest('/api/ai/reminder-message', {
      method: 'POST',
      body: {
        appointmentId: data.appointment.id,
        patientName: data.appointment.patient?.fullName || '',
        concern: data.appointment.problemDescription || data.appointment.prescription?.diagnosis || ''
      }
    });

    setAiBusy(false);
    if (!res.ok) {
      setMessage(res.data?.error || 'Could not generate reminder message.');
      return;
    }

    setSmartReminder(res.data?.result?.message || 'No reminder text returned.');
  };

  const stopPrescriptionAudio = () => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    setAudioBusy(false);
    setIsPlayingAudio(false);
    setAudioMessage('Audio stopped.');
  };

  const playPrescriptionAudio = async () => {
    if (!speechSupported || !data?.appointment?.prescription) {
      setAudioMessage('Audio playback is not available in this browser.');
      return;
    }

    setAudioMessage('');
    const preferredLanguage = getAppSelectedLanguage(user.language || data.appointment.patient?.language || 'English');
    const preferredLanguageName = resolvePreferredLanguageName(preferredLanguage);
    const languageCode = resolveSpeechLanguageCode(preferredLanguage);
    const localizedFallbackText = buildPrescriptionNarrationTextLocalized({
      language: preferredLanguageName,
      patientName: data.appointment.familyMember?.fullName || data.appointment.patient?.fullName || '',
      doctorName: `Dr. ${data.appointment.doctor?.fullName || 'your doctor'}`,
      diagnosis: data.appointment.prescription?.diagnosis || '',
      items: data.appointment.prescription?.items || [],
      instructions: data.appointment.prescription?.instructions || '',
      followUpAt: data.appointment.prescription?.followUpAt || null
    });

    let textToSpeak =
      String(narrationLanguage || '').trim().toLowerCase() === String(preferredLanguageName).trim().toLowerCase()
        ? stripHandoffCodeFromNarration(String(narrationText || simplifiedPrescription || '').trim())
        : '';

    if (!textToSpeak) {
      textToSpeak = localizedFallbackText;
    }

    textToSpeak = await ensureNarrationLanguage({
      appointmentId: data.appointment.id,
      targetLanguage: preferredLanguageName,
      preferredText: textToSpeak,
      fallbackText: localizedFallbackText
    });

    if (textToSpeak) {
      setNarrationText(textToSpeak);
      setNarrationLanguage(preferredLanguageName);
      setSimplifiedPrescription((prev) => prev || textToSpeak);
    }

    if (!textToSpeak) {
      setAudioMessage('No prescription details are available to read.');
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = languageCode;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    const voices = await loadSpeechVoices();
    const hasTargetLanguageVoice = hasMatchingSpeechVoice(voices, languageCode);
    const preferredVoice = resolveSpeechVoice(voices, languageCode);
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => {
      setIsPlayingAudio(true);
      if (hasTargetLanguageVoice) {
        setAudioMessage(`Playing prescription audio in ${preferredLanguageName} (${languageCode}).`);
      } else {
        setAudioMessage(`Playing with device default voice. ${preferredLanguageName} voice is not installed on this device.`);
      }
    };

    utterance.onend = () => {
      setIsPlayingAudio(false);
      setAudioMessage('Audio playback finished.');
    };

    utterance.onerror = () => {
      setIsPlayingAudio(false);
      setAudioMessage('Unable to play prescription audio. Please try again.');
    };

    window.speechSynthesis.speak(utterance);
  };

  if (loading) return <p className="muted">Loading prescription...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data?.appointment) return <p className="error">Prescription not found.</p>;

  const appointment = data.appointment;
  const prescription = appointment.prescription;
  const patientName = appointment.familyMember
    ? `${appointment.familyMember.fullName} (family)`
    : appointment.patient.fullName;
  const doctorName = `Dr. ${appointment.doctor.fullName}`;
  const instructionsText = prescription?.instructions || 'No specific dietary instructions provided for this diagnosis.';
  const preferredNarrationLanguage = resolvePreferredLanguageName(
    getAppSelectedLanguage(user.language || appointment.patient?.language || 'English')
  );
  const preferredSpeechCode = resolveSpeechLanguageCode(preferredNarrationLanguage);

  if (user.role === 'patient') {
    if (!prescription) {
      return (
        <section className="patient-prescription-shell">
          <header className="patient-prescription-topbar">
            <div className="patient-prescription-brand">Digital Sanctuary</div>
            <span className="material-symbols-outlined" aria-hidden="true">account_circle</span>
          </header>

          <main className="patient-prescription-main waiting">
            <h1>Prescription Pending</h1>
            <p>Your doctor has not issued a prescription yet for this appointment.</p>
            <Link className="patient-prescription-primary-cta" to={`/appointments/${appointmentId}`}>
              Back to Appointment Details
            </Link>
          </main>
        </section>
      );
    }

    return (
      <section className="patient-prescription-shell">
        <header className="patient-prescription-topbar">
          <div className="patient-prescription-brand">Digital Sanctuary</div>
          <button className="patient-prescription-icon" type="button" aria-label="Profile">
            <span className="material-symbols-outlined" aria-hidden="true">account_circle</span>
          </button>
        </header>

        <main className="patient-prescription-main">
          <header className="patient-prescription-hero">
            <h1>Prescription Ready.</h1>
            <p>
              Your consultation with {doctorName} is complete. Please share the code below with your pharmacist.
            </p>
          </header>

          <section className="patient-prescription-handoff">
            <span className="patient-prescription-label">Pharmacist Handoff Code</span>
            <p className="patient-prescription-code">{data.handoffCode}</p>
            <button type="button" onClick={copyHandoffCode}>
              <span className="material-symbols-outlined" aria-hidden="true">qr_code_2</span>
              {copyMessage}
            </button>
          </section>

          {cacheMeta.fromCache ? (
            <section className="patient-prescription-handoff">
              <span className="patient-prescription-label">📋 Showing saved prescription from {formatCachedAt(cacheMeta.cachedAt)}</span>
              <p>Show this to your pharmacist</p>
              <p className="patient-prescription-code">Handoff Code: {data.handoffCode}</p>
            </section>
          ) : null}

          <section className="patient-prescription-summary">
            <h2>
              <span className="material-symbols-outlined" aria-hidden="true">assignment</span>
              Appointment Summary
            </h2>
            <div className="patient-prescription-summary-grid">
              <article>
                <small>Doctor</small>
                <p>{doctorName}</p>
              </article>
              <article>
                <small>Patient</small>
                <p>{patientName}</p>
              </article>
              <article className="wide">
                <small>Session ID</small>
                <p className="mono">{appointment.id}</p>
              </article>
            </div>
          </section>

          <section className="patient-prescription-diagnosis">
            <small>Primary Diagnosis</small>
            <div>
              <span className="material-symbols-outlined" aria-hidden="true">healing</span>
              <h2>{prescription.diagnosis}</h2>
            </div>
          </section>

          <section className="patient-prescription-medications">
            <h2>Prescribed Medications</h2>

            {(prescription.items || []).map((item, idx) => (
              <article key={`${item.name || 'Medication'}-${idx}`}>
                <div className="icon">
                  <span className="material-symbols-outlined" aria-hidden="true">medication</span>
                </div>

                <div className="content">
                  <h3>{item.name || 'Medication'}</h3>
                  <p>{item.dosage || 'Dosage not specified'}</p>

                  <div className="meta-grid">
                    <div>
                      <small>Frequency</small>
                      <strong>{item.frequency || 'N/A'}</strong>
                    </div>
                    <div>
                      <small>Duration</small>
                      <strong>{item.duration || 'N/A'}</strong>
                    </div>
                    <div>
                      <small>Possible Side Effects</small>
                      <strong>{formatSideEffectsText(item.sideEffects) || 'N/A'}</strong>
                    </div>
                  </div>
                </div>
              </article>
            ))}

            {(prescription.items || []).length === 0 ? (
              <p className="muted">No medications listed.</p>
            ) : null}
          </section>

          <section className="patient-prescription-instructions">
            <h2>
              <span className="material-symbols-outlined" aria-hidden="true">info</span>
              Doctor's Instructions
            </h2>
            <p>{instructionsText}</p>
          </section>

          <section className="patient-prescription-audio">
            <h2>
              <span className="material-symbols-outlined" aria-hidden="true">volume_up</span>
              Listen in Your Language
            </h2>
            <p>
              Preferred language: <strong>{preferredNarrationLanguage}</strong> ({preferredSpeechCode})
            </p>
            <div className="row-inline wrap">
              <button type="button" onClick={playPrescriptionAudio} disabled={audioBusy || isPlayingAudio}>
                {audioBusy ? 'Preparing audio...' : isPlayingAudio ? 'Playing...' : 'Listen Prescription'}
              </button>
              <button type="button" className="ghost" onClick={stopPrescriptionAudio} disabled={!isPlayingAudio}>
                Stop Audio
              </button>
            </div>
            {!speechSupported ? <p className="muted">Audio playback is not supported in this browser.</p> : null}
            {audioMessage ? <p className="muted">{audioMessage}</p> : null}
          </section>

          <section className="patient-prescription-instructions">
            <h2>
              <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              AI Assist
            </h2>
            <div className="row-inline wrap">
              <button type="button" onClick={generatePatientFriendlyText} disabled={aiBusy}>
                {aiBusy ? 'Generating...' : 'Simplify Prescription'}
              </button>
              <button type="button" onClick={generateReminderMessage} disabled={aiBusy}>
                {aiBusy ? 'Generating...' : 'Generate Reminder Message'}
              </button>
            </div>
            {simplifiedPrescription ? <p>{simplifiedPrescription}</p> : null}
            {smartReminder ? <p>{smartReminder}</p> : null}
          </section>

          <div className="patient-prescription-actions">
            <Link
              to={buildPdfPreviewLink(
                `/api/prescriptions/${appointmentId}/pdf`,
                `Prescription ${appointmentId}`,
                `/api/prescriptions/${appointmentId}/pdf?download=1`,
                appointmentId
              )}
            >
              <span className="material-symbols-outlined" aria-hidden="true">download</span>
              Preview PDF Prescription
            </Link>
            <Link to={`/ai-copilot?appointmentId=${appointmentId}`}>
              <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              Explain with AI Copilot
            </Link>
            <small>Valid for 30 days from date of issue.</small>
          </div>
        </main>

        <nav className="patient-prescription-bottom-nav" aria-label="Patient quick navigation">
          <Link to="/dashboard">
            <span className="material-symbols-outlined" aria-hidden="true">home_health</span>
            <span>Home</span>
          </Link>
          <Link className="active" to="/appointments">
            <span className="material-symbols-outlined" aria-hidden="true">calendar_month</span>
            <span>Visits</span>
          </Link>
          <Link to="/appointments">
            <span className="material-symbols-outlined" aria-hidden="true">chat_bubble</span>
            <span>Messages</span>
          </Link>
          <Link to="/patients/workspace">
            <span className="material-symbols-outlined" aria-hidden="true">contact_support</span>
            <span>Help</span>
          </Link>
        </nav>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h2>Prescription</h2>
        {message ? <p className={message.toLowerCase().includes('unable') ? 'error' : 'success'}>{message}</p> : null}
        <p>
          <strong>Appointment:</strong> {appointment.id}
        </p>
        <p>
          <strong>Handoff code:</strong> <span className="pill">{data.handoffCode}</span>
        </p>
        <p>
          <strong>Doctor:</strong> {appointment.doctor.fullName} | <strong>Patient:</strong> {patientName}
        </p>
        <Link
          className="btn subtle"
          to={buildPdfPreviewLink(
            `/api/prescriptions/${appointmentId}/pdf`,
            `Prescription ${appointmentId}`,
            `/api/prescriptions/${appointmentId}/pdf?download=1`,
            appointmentId
          )}
        >
          Preview PDF
        </Link>
      </section>

      {prescription ? (
        <section className="card">
          <h3>Current prescription</h3>
          <p>
            <strong>Diagnosis:</strong> {prescription.diagnosis}
          </p>
          {(prescription.items || []).map((item, idx) => (
            <article className="list-item" key={`${item.name}-${idx}`}>
              <div>
                <strong>
                  {idx + 1}. {item.name || 'Medication'}
                </strong>
                <p className="muted">
                  {item.dosage || 'N/A'} | {item.frequency || 'N/A'} | {item.duration || 'N/A'}
                </p>
                <p className="muted">
                  Side effects: {formatSideEffectsText(item.sideEffects) || 'N/A'}
                </p>
              </div>
            </article>
          ))}
          <p>
            <strong>Instructions:</strong> {prescription.instructions || 'N/A'}
          </p>
        </section>
      ) : null}

      {isDoctorOwner ? (
        <section className="card">
          <h3>{prescription ? 'Edit' : 'Create'} prescription</h3>
          <form className="stack" onSubmit={savePrescription}>
            <label>
              Diagnosis
              <input
                value={form.diagnosis}
                onChange={(e) => setForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                required
              />
            </label>

            <div className="stack">
              <div className="row-between">
                <h4>Medications</h4>
                <button
                  type="button"
                  className="ghost"
                  onClick={() =>
                    setRows((prev) => [...prev, { medicationName: '', dosage: '', frequency: '', duration: '', sideEffects: '' }])
                  }
                >
                  Add medicine
                </button>
              </div>

              {rows.map((row, idx) => (
                <div className="grid five" key={`row-${idx}`}>
                  <label>
                    Name
                    <input
                      value={row.medicationName}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((entry, entryIdx) =>
                            entryIdx === idx ? { ...entry, medicationName: e.target.value } : entry
                          )
                        )
                      }
                      required
                    />
                  </label>
                  <label>
                    Dosage
                    <input
                      value={row.dosage}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((entry, entryIdx) => (entryIdx === idx ? { ...entry, dosage: e.target.value } : entry))
                        )
                      }
                    />
                  </label>
                  <label>
                    Frequency
                    <input
                      value={row.frequency}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((entry, entryIdx) =>
                            entryIdx === idx ? { ...entry, frequency: e.target.value } : entry
                          )
                        )
                      }
                    />
                  </label>
                  <label>
                    Duration
                    <input
                      value={row.duration}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((entry, entryIdx) =>
                            entryIdx === idx ? { ...entry, duration: e.target.value } : entry
                          )
                        )
                      }
                    />
                  </label>
                  <label>
                    Possible side effects
                    <input
                      value={row.sideEffects}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((entry, entryIdx) =>
                            entryIdx === idx ? { ...entry, sideEffects: e.target.value } : entry
                          )
                        )
                      }
                      placeholder="e.g., nausea, dry mouth"
                    />
                  </label>
                </div>
              ))}
            </div>

            <label>
              Instructions
              <textarea
                value={form.instructions}
                onChange={(e) => setForm((prev) => ({ ...prev, instructions: e.target.value }))}
              />
            </label>
            <label>
              Follow-up date
              <input
                type="date"
                value={form.followUpAt}
                onChange={(e) => setForm((prev) => ({ ...prev, followUpAt: e.target.value }))}
              />
            </label>
            <label>
              Preferred pharmacy
              <input
                value={form.pharmacyName}
                onChange={(e) => setForm((prev) => ({ ...prev, pharmacyName: e.target.value }))}
              />
            </label>
            <label>
              Pharmacy contact
              <input
                value={form.pharmacyContact}
                onChange={(e) => setForm((prev) => ({ ...prev, pharmacyContact: e.target.value }))}
              />
            </label>
            <label>
              Notes
              <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
            </label>
            <button type="submit">Save prescription</button>
          </form>
        </section>
      ) : null}
    </>
  );
}

function AICopilotPage() {
  const { user } = useSession();
  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const prefillAppointmentId = searchParams.get('appointmentId') || '';
  const prefillDocumentId = searchParams.get('documentId') || '';

  const [contextLoading, setContextLoading] = useState(true);
  const [refreshingContext, setRefreshingContext] = useState(false);
  const [contextError, setContextError] = useState('');
  const [contextData, setContextData] = useState({
    appointments: [],
    documents: [],
    delegatedPatients: []
  });

  const [appointmentId, setAppointmentId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [patientId, setPatientId] = useState('');

  const [draftFocus, setDraftFocus] = useState('');
  const [simplifierLanguage, setSimplifierLanguage] = useState(user.language || 'English');
  const [referralReason, setReferralReason] = useState('');
  const [referralSpecialty, setReferralSpecialty] = useState('');
  const [referralUrgency, setReferralUrgency] = useState('within_7_days');
  const [referralTriedTreatment, setReferralTriedTreatment] = useState('');
  const [asyncThreadSummary, setAsyncThreadSummary] = useState('');
  const [asyncThreadMessage, setAsyncThreadMessage] = useState('');
  const [activeFeature, setActiveFeature] = useState('');

  const [busyMap, setBusyMap] = useState({});
  const [errorMap, setErrorMap] = useState({});
  const [resultMap, setResultMap] = useState({});
  const [offlineDrafts, setOfflineDrafts] = useState(() => {
    try {
      const raw = window.localStorage.getItem(AI_OFFLINE_DRAFTS_KEY);
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  });

  const appointments = contextData.appointments || [];
  const documents = contextData.documents || [];
  const delegatedPatients = contextData.delegatedPatients || [];
  const selectedAppointment = useMemo(
    () => appointments.find((row) => row.id === appointmentId) || null,
    [appointments, appointmentId]
  );

  const aiFeatureButtons = useMemo(
    () => [
      {
        key: 'draftNote',
        title: 'Doctor Note Drafting',
        description: 'Generate structured SOAP draft notes.',
        icon: 'description',
        restricted: !(user.role === 'doctor' || user.role === 'admin')
      },
      {
        key: 'simplifyPrescription',
        title: 'Prescription Simplifier',
        description: 'Convert prescriptions into patient-friendly language.',
        icon: 'medication'
      },
      {
        key: 'referralSummary',
        title: 'Referral Summary',
        description: 'Create specialist referral draft and checklist.',
        icon: 'summarize',
        restricted: !(user.role === 'doctor' || user.role === 'admin')
      },
      {
        key: 'asyncReply',
        title: 'Async Reply Suggestion',
        description: 'Draft a safe response to patient follow-ups.',
        icon: 'quickreply'
      }
    ],
    [user.role]
  );

  const activeFeatureConfig = aiFeatureButtons.find((item) => item.key === activeFeature) || null;

  useEffect(() => {
    try {
      window.localStorage.setItem(AI_OFFLINE_DRAFTS_KEY, JSON.stringify(offlineDrafts.slice(0, 80)));
    } catch (_err) {
      // Ignore local storage persistence errors.
    }
  }, [offlineDrafts]);

  const loadContext = useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshingContext(true);
    } else {
      setContextLoading(true);
    }
    setContextError('');

    try {
      const res = await apiRequest('/api/ai/context');
      if (!res.ok) {
        setContextError(res.data?.error || 'Unable to load AI context.');
        return;
      }

      setContextData({
        appointments: res.data?.appointments || [],
        documents: res.data?.documents || [],
        delegatedPatients: res.data?.delegatedPatients || []
      });
    } catch (_err) {
      setContextError('Unable to load AI context due to network issues.');
    } finally {
      setContextLoading(false);
      setRefreshingContext(false);
    }
  }, []);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  useEffect(() => {
    if (!appointments.length) return;
    setAppointmentId((prev) => prev || prefillAppointmentId || appointments[0].id || '');
  }, [appointments, prefillAppointmentId]);

  useEffect(() => {
    if (!documents.length) return;
    setDocumentId((prev) => prev || prefillDocumentId || documents[0].id || '');
  }, [documents, prefillDocumentId]);

  useEffect(() => {
    if (!delegatedPatients.length) return;
    setPatientId((prev) => prev || delegatedPatients[0].id || '');
  }, [delegatedPatients]);

  useEffect(() => {
    const preferredLanguage = selectedAppointment?.patient?.language || selectedAppointment?.doctor?.language || user.language || 'English';
    if (!selectedAppointment) return;
    setSimplifierLanguage(preferredLanguage);
  }, [selectedAppointment, user.language]);

  const queueOfflineDraft = useCallback((key, path, body) => {
    const draft = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      key,
      path,
      body,
      createdAt: new Date().toISOString()
    };
    setOfflineDrafts((prev) => [draft, ...prev].slice(0, 80));
  }, []);

  const retryOfflineDraft = useCallback(async (draft) => {
    const res = await apiRequest(draft.path, {
      method: 'POST',
      body: draft.body
    });

    if (!res.ok) {
      throw new Error(res.data?.error || 'Retry failed');
    }

    setResultMap((prev) => ({ ...prev, [draft.key]: res.data }));
  }, []);

  const retryAllOfflineDrafts = useCallback(async () => {
    if (!offlineDrafts.length) return;
    setBusyMap((prev) => ({ ...prev, offlineRetry: true }));
    const remaining = [];

    for (const draft of offlineDrafts) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await retryOfflineDraft(draft);
      } catch (_err) {
        remaining.push(draft);
      }
    }

    setOfflineDrafts(remaining);
    setBusyMap((prev) => ({ ...prev, offlineRetry: false }));
  }, [offlineDrafts, retryOfflineDraft]);

  const runFeature = async (key, path, body) => {
    setBusyMap((prev) => ({ ...prev, [key]: true }));
    setErrorMap((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await apiRequest(path, {
        method: 'POST',
        body
      });

      if (!res.ok) {
        setErrorMap((prev) => ({ ...prev, [key]: res.data?.error || 'Unable to complete this AI action.' }));
        return;
      }

      setResultMap((prev) => ({ ...prev, [key]: res.data }));
    } catch (_err) {
      queueOfflineDraft(key, path, body);
      setErrorMap((prev) => ({ ...prev, [key]: 'Network issue detected. Draft saved offline for retry.' }));
    } finally {
      setBusyMap((prev) => ({ ...prev, [key]: false }));
    }
  };

  const renderStringList = (items) => {
    if (!Array.isArray(items) || !items.length) return null;

    return (
      <ul className="ai-result-list">
        {items.filter(Boolean).map((item, idx) => (
          <li key={`${item}-${idx}`}>{String(item)}</li>
        ))}
      </ul>
    );
  };

  const renderMeta = (data) => (
    <div className="ai-result-meta">
      <span className="pill">{data.requiresReview ? 'Draft - requires human review' : 'Human review optional'}</span>
    </div>
  );

  const renderResult = (key) => {
    const data = resultMap[key];
    if (!data) return null;

    const result = data?.result || {};

    if (key === 'draftNote') {
      return (
        <div className="ai-result-box">
          {renderMeta(data)}
          <div className="ai-result-kv-grid">
            {result.subjective ? <article><h5>Subjective</h5><p>{result.subjective}</p></article> : null}
            {result.objective ? <article><h5>Objective</h5><p>{result.objective}</p></article> : null}
            {result.assessment ? <article><h5>Assessment</h5><p>{result.assessment}</p></article> : null}
            {result.plan ? <article><h5>Plan</h5><p>{result.plan}</p></article> : null}
          </div>
          {renderStringList(result.followUpQuestions) ? (
            <article className="ai-result-section">
              <h5>Follow-up Questions</h5>
              {renderStringList(result.followUpQuestions)}
            </article>
          ) : null}
          {renderStringList(result.riskFlags) ? (
            <article className="ai-result-section">
              <h5>Risk Flags</h5>
              {renderStringList(result.riskFlags)}
            </article>
          ) : null}
          {result.safetyNote ? <p className="ai-result-callout">{result.safetyNote}</p> : null}
        </div>
      );
    }

    if (key === 'simplifyPrescription') {
      return (
        <div className="ai-result-box">
          {renderMeta(data)}
          <article className="ai-result-section">
            <h5>Patient-Friendly Prescription</h5>
            <p>{result.plainLanguage || result.overview || result.message || 'No simplification returned.'}</p>
          </article>
        </div>
      );
    }

    if (key === 'referralSummary') {
      return (
        <div className="ai-result-box">
          {renderMeta(data)}
          <article className="ai-result-section">
            <h5>Referral Draft Paragraph</h5>
            <p>{result.summaryParagraph || result.message || 'No referral summary returned.'}</p>
          </article>
          {renderStringList(result.referralChecklist) ? (
            <article className="ai-result-section">
              <h5>Referral Checklist</h5>
              {renderStringList(result.referralChecklist)}
            </article>
          ) : null}
        </div>
      );
    }

    if (key === 'asyncReply') {
      return (
        <div className="ai-result-box">
          {renderMeta(data)}
          <article className="ai-result-section">
            <h5>Suggested Doctor Reply</h5>
            <p>{result.suggestedReply || result.message || 'No suggestion returned.'}</p>
          </article>
          {renderStringList(result.reasoningHighlights) ? (
            <article className="ai-result-section">
              <h5>Why This Reply</h5>
              {renderStringList(result.reasoningHighlights)}
            </article>
          ) : null}
        </div>
      );
    }

    return (
      <div className="ai-result-box">
        {renderMeta(data)}
        <p className="muted">Result received.</p>
      </div>
    );
  };

  if (contextLoading) return <p className="muted">Preparing AI Copilot workspace...</p>;

  return (
    <section className="ai-sanctuary-shell">
      <header className="ai-sanctuary-top">
        <div>
          <p className="kicker">Clinical Workspace</p>
          <h2>AI Copilot Workspace</h2>
          <p className="muted">Fast draft support with strict review controls for safe clinical decisions.</p>
        </div>
        <div className="ai-top-actions">
          <button type="button" className="compass-toggle-btn" onClick={() => loadContext({ silent: true })} disabled={refreshingContext}>
            {refreshingContext ? 'Refreshing...' : 'Refresh context'}
          </button>
        </div>
      </header>

      {activeFeature ? (
      <section className="ai-safety-banner">
        <span className="material-symbols-outlined" aria-hidden="true">gavel</span>
        <div>
          <h4>Clinical Safety Protocol</h4>
          <p>Every output is a draft. Human review is mandatory before any diagnosis, treatment, or patient communication.</p>
        </div>
      </section>
      ) : null}

      {activeFeature && contextError ? <p className="error">{contextError}</p> : null}

      {activeFeature ? (
      <div className="ai-status-grid">
      <article className="compass-card ai-panel">
        <h3>Offline draft queue</h3>
        <p className="muted">
          Failed AI requests are saved locally so low-connectivity users can retry safely.
        </p>
        <div className="row-inline">
          <span className="pill">Queued drafts: {offlineDrafts.length}</span>
          <button type="button" className="compass-action-btn subtle" onClick={retryAllOfflineDrafts} disabled={!offlineDrafts.length || busyMap.offlineRetry}>
            {busyMap.offlineRetry ? 'Retrying...' : 'Retry all drafts'}
          </button>
          <button type="button" className="compass-action-btn subtle" onClick={() => setOfflineDrafts([])} disabled={!offlineDrafts.length || busyMap.offlineRetry}>
            Clear queue
          </button>
        </div>
        {offlineDrafts.length ? (
          <div className="metric-stack">
            {offlineDrafts.slice(0, 8).map((draft) => (
              <p key={draft.id}>
                <strong>{draft.key}</strong>
                {' - queued at '}
                {new Date(draft.createdAt).toLocaleString()}
              </p>
            ))}
          </div>
        ) : (
          <p className="muted">No queued drafts right now.</p>
        )}
      </article>
      </div>
      ) : null}

      {activeFeature ? (
      <article className="compass-card ai-context-panel">
        <h3>Shared Context Configuration</h3>
        <div className="compass-inline-grid">
          <label>
            Appointment context
            <select value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
              <option value="">Choose appointment</option>
              {appointments.map((appointment) => (
                <option key={appointment.id} value={appointment.id}>
                  {formatPrettyDate(appointment.startAt)} - Dr. {appointment.doctor?.fullName || 'Doctor'}
                </option>
              ))}
            </select>
          </label>

          <label>
            Document context
            <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">Choose document</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.fileName}
                </option>
              ))}
            </select>
          </label>

          <label>
            Delegated patient
            <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Choose patient</option>
              {delegatedPatients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {patient.fullName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </article>
      ) : null}

      <article className="compass-card ai-feature-launcher">
        <h3>AI Help Features</h3>
        <p className="muted">Select one feature button to open it. The full page stays hidden until you choose.</p>
        <div className="ai-feature-button-grid">
          {aiFeatureButtons.map((feature) => (
            <button
              key={feature.key}
              type="button"
              className={`ai-feature-btn ${activeFeature === feature.key ? 'active' : ''}`}
              onClick={() => setActiveFeature(feature.key)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">{feature.icon}</span>
              <span>
                <strong>{feature.title}</strong>
                <small>{feature.restricted ? 'Doctor/Admin only' : feature.description}</small>
              </span>
            </button>
          ))}
        </div>
        {activeFeature ? (
          <button type="button" className="compass-action-btn subtle" onClick={() => setActiveFeature('')}>
            Back to feature buttons
          </button>
        ) : null}
      </article>

      {activeFeature ? <h3 className="ai-toolbox-title">{activeFeatureConfig?.title || 'AI Toolbox'}</h3> : null}
      {!activeFeature ? <p className="muted">Choose a feature above to start.</p> : null}

      {activeFeature ? (
      <div className="ai-toolbox-grid">
        {activeFeature === 'draftNote' ? (
        <article className="compass-card ai-tool-card">
          <h3>Doctor Note Drafting</h3>
          <form
            className="compass-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!(user.role === 'doctor' || user.role === 'admin')) {
                setErrorMap((prev) => ({ ...prev, draftNote: 'Doctor-only feature. Ask a clinician to generate this draft.' }));
                return;
              }
              if (!appointmentId) {
                setErrorMap((prev) => ({ ...prev, draftNote: 'Select an appointment first.' }));
                return;
              }
              runFeature('draftNote', '/api/ai/draft-note', {
                appointmentId,
                focus: draftFocus,
                patientId: patientId || selectedAppointment?.patient?.id || '',
                problemDescription: selectedAppointment?.problemDescription || '',
                medicationsText: selectedAppointment?.medicationsText || ''
              });
            }}
          >
            <label>
              Focus (optional)
              <textarea value={draftFocus} onChange={(e) => setDraftFocus(e.target.value)} rows={3} placeholder="Example: emphasize red flags and follow-up plan" />
            </label>
            <button type="submit" className="compass-action-btn small" disabled={busyMap.draftNote || !(user.role === 'doctor' || user.role === 'admin')}>
              {busyMap.draftNote ? 'Generating...' : 'Generate Draft Note'}
            </button>
            {!(user.role === 'doctor' || user.role === 'admin') ? (
              <p className="muted">Visible for transparency. Only doctor/admin roles can run this feature.</p>
            ) : null}
            {selectedAppointment ? (
              <p className="muted">
                Uses shared context from appointment, patient profile, and any selected delegated patient.
              </p>
            ) : null}
            {errorMap.draftNote ? <p className="error">{errorMap.draftNote}</p> : null}
          </form>
          {renderResult('draftNote')}
        </article>
        ) : null}

      {activeFeature === 'simplifyPrescription' ? (
      <article className="compass-card ai-tool-card">
        <h3>AI Prescription Simplifier</h3>
        <form
          className="compass-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!appointmentId) {
              setErrorMap((prev) => ({ ...prev, simplifyPrescription: 'Select an appointment first.' }));
              return;
            }
            runFeature('simplifyPrescription', '/api/ai/prescription-simplify', {
              appointmentId,
              language: simplifierLanguage,
              patientId: patientId || ''
            });
          }}
        >
          <label>
            Language
            <input value={simplifierLanguage} onChange={(e) => setSimplifierLanguage(e.target.value)} />
          </label>
          <button type="submit" className="compass-action-btn small" disabled={busyMap.simplifyPrescription}>
            {busyMap.simplifyPrescription ? 'Generating...' : 'Generate Simplified Instructions'}
          </button>
          {errorMap.simplifyPrescription ? <p className="error">{errorMap.simplifyPrescription}</p> : null}
        </form>
        {renderResult('simplifyPrescription')}
      </article>
      ) : null}

      {activeFeature === 'referralSummary' ? (
      <article className="compass-card ai-tool-card">
        <h3>Consultation Summary for Referral</h3>
        <form
          className="compass-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!(user.role === 'doctor' || user.role === 'admin')) {
              setErrorMap((prev) => ({ ...prev, referralSummary: 'Doctor-only feature. Ask a clinician to generate this referral draft.' }));
              return;
            }
            if (!appointmentId) {
              setErrorMap((prev) => ({ ...prev, referralSummary: 'Select an appointment first.' }));
              return;
            }
            if (!referralReason.trim()) {
              setErrorMap((prev) => ({ ...prev, referralSummary: 'Add the referral reason before generating.' }));
              return;
            }
            runFeature('referralSummary', '/api/ai/referral-summary', {
              appointmentId,
              targetSpecialty: referralSpecialty,
              referralReason,
              urgency: referralUrgency,
              triedTreatment: referralTriedTreatment,
              language: simplifierLanguage
            });
          }}
        >
          <label>
            Referral reason
            <textarea
              value={referralReason}
              onChange={(e) => setReferralReason(e.target.value)}
              rows={3}
              required
              placeholder="Example: persistent chest pain despite initial therapy, needs cardiology evaluation"
            />
          </label>
          <label>
            Target specialty (optional)
            <input
              value={referralSpecialty}
              onChange={(e) => setReferralSpecialty(e.target.value)}
              placeholder="Example: Cardiology"
            />
          </label>
          <label>
            Urgency
            <select value={referralUrgency} onChange={(e) => setReferralUrgency(e.target.value)}>
              <option value="emergency">Emergency</option>
              <option value="urgent">Urgent</option>
              <option value="within_7_days">Within 7 days</option>
              <option value="routine">Routine</option>
            </select>
          </label>
          <label>
            Tried treatment (optional)
            <textarea
              value={referralTriedTreatment}
              onChange={(e) => setReferralTriedTreatment(e.target.value)}
              rows={3}
              placeholder="List treatment already tried before referral"
            />
          </label>
          <button type="submit" className="compass-action-btn small" disabled={busyMap.referralSummary || !(user.role === 'doctor' || user.role === 'admin')}>
            {busyMap.referralSummary ? 'Generating...' : 'Generate Referral Summary'}
          </button>
          {!(user.role === 'doctor' || user.role === 'admin') ? (
            <p className="muted">Visible for transparency. Only doctor/admin roles can run this feature.</p>
          ) : null}
          {errorMap.referralSummary ? <p className="error">{errorMap.referralSummary}</p> : null}
        </form>
        {renderResult('referralSummary')}
      </article>
      ) : null}

      {activeFeature === 'asyncReply' ? (
      <article className="compass-card ai-tool-card">
        <h3>Doctor Response Suggester (Async)</h3>
        <form
          className="compass-form"
          onSubmit={(event) => {
            event.preventDefault();
            runFeature('asyncReply', '/api/ai/async-reply-suggest', {
              appointmentId,
              patientId: patientId || '',
              threadSummary: asyncThreadSummary,
              latestPatientMessage: asyncThreadMessage
            });
          }}
        >
          <label>
            Thread summary
            <textarea
              value={asyncThreadSummary}
              onChange={(e) => setAsyncThreadSummary(e.target.value)}
              rows={3}
              placeholder="Briefly summarize the case context"
            />
          </label>
          <label>
            Latest patient message
            <textarea
              value={asyncThreadMessage}
              onChange={(e) => setAsyncThreadMessage(e.target.value)}
              rows={3}
              required
            />
          </label>
          <button type="submit" className="compass-action-btn small" disabled={busyMap.asyncReply}>
            {busyMap.asyncReply ? 'Drafting...' : 'Suggest Doctor Reply'}
          </button>
          {errorMap.asyncReply ? <p className="error">{errorMap.asyncReply}</p> : null}
        </form>
        {renderResult('asyncReply')}
      </article>
      ) : null}
      </div>
      ) : null}
    </section>
  );
}

function ProfilePage() {
  const navigate = useNavigate();
  const { refreshSession } = useSession();
  const { isOnline, networkType, isDataSaver, setIsDataSaver } = useRuralSupport();
  const { data, setData, error, loading } = useApiPage('/api/users/me');
  const [message, setMessage] = useState('');
  const [languageOpen, setLanguageOpen] = useState(false);
  const [shareProfileOpen, setShareProfileOpen] = useState(false);
  const [abhaForm, setAbhaForm] = useState({ abhaId: '', abhaAddress: '' });
  const [abhaMessage, setAbhaMessage] = useState('');
  const [abhaBusy, setAbhaBusy] = useState(false);
  const [shareProfileBusy, setShareProfileBusy] = useState(false);
  const [shareProfileData, setShareProfileData] = useState(null);
  const [shareProfileMessage, setShareProfileMessage] = useState('');
  const [profileQrImage, setProfileQrImage] = useState('');
  const [profileQrError, setProfileQrError] = useState(false);

  const user = data?.user || null;

  const profileShareUrl = useMemo(() => {
    const raw = String(shareProfileData?.qrUrl || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }, [shareProfileData]);

  const healthAction = user?.role === 'patient'
    ? { to: '/patients/workspace', label: 'Health Workspace', icon: 'monitor_heart' }
    : user?.role === 'doctor'
      ? { to: '/doctors/me/analytics', label: 'Health Analytics', icon: 'query_stats' }
      : user?.role === 'help_worker'
        ? { to: '/support/consents', label: 'Care Support', icon: 'volunteer_activism' }
        : { to: '/dashboard', label: 'Health Dashboard', icon: 'dashboard' };

  useEffect(() => {
    let disposed = false;

    if (!profileShareUrl) {
      setProfileQrImage('');
      setProfileQrError(false);
      return undefined;
    }

    QRCode.toDataURL(profileShareUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M'
    })
      .then((dataUrl) => {
        if (disposed) return;
        setProfileQrImage(dataUrl);
        setProfileQrError(false);
      })
      .catch(() => {
        if (disposed) return;
        setProfileQrImage('');
        setProfileQrError(true);
      });

    return () => {
      disposed = true;
    };
  }, [profileShareUrl]);

  useEffect(() => {
    if (!user || user.role !== 'patient') return;

    let mounted = true;

    const loadAbha = async () => {
      const res = await apiRequest('/api/innovations/patients/me/abha');
      if (!mounted || !res.ok) return;
      setAbhaForm({
        abhaId: res.data?.abha?.abhaId || '',
        abhaAddress: res.data?.abha?.abhaAddress || ''
      });
    };

    loadAbha();
    return () => {
      mounted = false;
    };
  }, [user?.id, user?.role]);

  if (loading) return <p className="muted">Loading profile...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!user) return <p className="error">Profile not found.</p>;

  const save = async (event) => {
    event.preventDefault();
    setMessage('');
    const formData = new FormData(event.currentTarget);
    const body = Object.fromEntries(formData.entries());

    const res = await apiRequest('/api/users/me', { method: 'POST', body });
    if (!res.ok) {
      setMessage(res.data?.error || 'Could not update profile.');
      return;
    }
    setData(res.data);
    setMessage(res.data?.message || 'Profile saved.');
  };

  const saveAbha = async (event) => {
    event.preventDefault();
    setAbhaMessage('');
    setAbhaBusy(true);

    const res = await apiRequest('/api/innovations/patients/me/abha', {
      method: 'POST',
      body: {
        abhaId: abhaForm.abhaId,
        abhaAddress: abhaForm.abhaAddress
      }
    });

    setAbhaBusy(false);

    if (!res.ok) {
      setAbhaMessage(res.data?.error || 'Could not save ABHA profile link.');
      return;
    }

    setAbhaMessage('ABHA profile link saved.');
  };

  const createProfileShareQr = async () => {
    if (user.role !== 'patient') return;

    setShareProfileBusy(true);
    setShareProfileMessage('');

    const res = await apiRequest('/api/innovations/patients/qr-token', {
      method: 'POST',
      body: {
        patientId: user.id,
        label: 'Profile share',
        expiresInHours: 12
      }
    });

    setShareProfileBusy(false);

    if (!res.ok) {
      setShareProfileMessage(res.data?.error || res.data?.message || 'Could not generate profile share QR.');
      return;
    }

    setShareProfileData(res.data || null);
    setShareProfileMessage('Profile QR generated. It will expire in 12 hours.');
  };

  const copyProfileShareLink = async () => {
    if (!profileShareUrl) return;

    try {
      await navigator.clipboard.writeText(profileShareUrl);
      setShareProfileMessage('Profile link copied.');
    } catch (_error) {
      setShareProfileMessage('Copy failed. Please copy the link manually.');
    }
  };

  const shareProfileLink = async () => {
    if (!profileShareUrl) return;

    if (!navigator.share) {
      await copyProfileShareLink();
      return;
    }

    try {
      await navigator.share({
        title: `${user.fullName} profile`,
        text: `Shared profile for ${user.fullName}`,
        url: profileShareUrl
      });
      setShareProfileMessage('Profile link shared.');
    } catch (_error) {}
  };

  const shareProfileOnWhatsApp = () => {
    if (!profileShareUrl) return;
    const shareText = `Shared health profile: ${profileShareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener,noreferrer');
  };

  const onLogout = async () => {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    await refreshSession();
    navigate('/auth/login', { replace: true });
  };

  return (
    <section className="journey-profile-shell">
      <header className="journey-profile-hero">
        <div className="journey-profile-avatar">{String(user.fullName || 'U').slice(0, 1).toUpperCase()}</div>
        <div>
          <h2 className="journey-title">My Profile</h2>
          <p className="journey-sub">Manage your health records and contact details.</p>
        </div>
      </header>

      {message ? <p className={message.toLowerCase().includes('could not') ? 'error' : 'success'}>{message}</p> : null}

      <section className="journey-form-card profile-action-center">
        <div className="journey-form-head">
          <span className="material-symbols-outlined" aria-hidden="true">tune</span>
          <h3>Profile Quick Actions</h3>
        </div>

        <p className={`profile-network-status ${isOnline ? 'online' : 'offline'}`}>
          <span className="material-symbols-outlined" aria-hidden="true">
            {isOnline ? 'network_wifi' : 'wifi_off'}
          </span>
          <span>{isOnline ? `Network: ${networkType}` : 'Offline mode enabled'}</span>
        </p>

        <div className="profile-action-grid">
          <Link className="profile-menu-item sanctuary-profile-item" to="/profile">
            <span className="sanctuary-profile-item-icon" aria-hidden="true">
              <span className="material-symbols-outlined">person</span>
            </span>
            <span>My Profile</span>
          </Link>

          <Link className="profile-menu-item sanctuary-profile-item" to={healthAction.to}>
            <span className="sanctuary-profile-item-icon" aria-hidden="true">
              <span className="material-symbols-outlined">{healthAction.icon}</span>
            </span>
            <span>{healthAction.label}</span>
          </Link>

          {user.role === 'patient' ? (
            <Link className="profile-menu-item sanctuary-profile-item" to="/medicines">
              <span className="sanctuary-profile-item-icon" aria-hidden="true">
                <span className="material-symbols-outlined">pill</span>
              </span>
              <span>My Medicines</span>
            </Link>
          ) : null}

          <Link className="profile-menu-item sanctuary-profile-item" to="/pharmacy/orders">
            <span className="sanctuary-profile-item-icon" aria-hidden="true">
              <span className="material-symbols-outlined">local_pharmacy</span>
            </span>
            <span>Pharmacy Orders</span>
          </Link>

          <Link className="profile-menu-item sanctuary-profile-item" to="/labs/tests">
            <span className="sanctuary-profile-item-icon" aria-hidden="true">
              <span className="material-symbols-outlined">biotech</span>
            </span>
            <span>Lab Tests</span>
          </Link>
        </div>

        <div className="profile-support-block">
          <button className="profile-menu-item sanctuary-profile-item profile-inline-toggle" type="button" onClick={() => setIsDataSaver((prev) => !prev)}>
            <span className="sanctuary-profile-item-icon" aria-hidden="true">
              <span className="material-symbols-outlined">{isDataSaver ? 'speed_0_5x' : 'speed'}</span>
            </span>
            <span>{isDataSaver ? 'Data Saver ON' : 'Data Saver OFF'}</span>
          </button>

          <button
            className="profile-menu-item sanctuary-profile-item profile-language-trigger"
            type="button"
            aria-expanded={languageOpen}
            aria-controls="profile-language-picker"
            onClick={() => {
              setLanguageOpen((prev) => !prev);
              setShareProfileOpen(false);
            }}
          >
            <span className="sanctuary-profile-item-icon" aria-hidden="true">
              <span className="material-symbols-outlined">translate</span>
            </span>
            <span>Language</span>
            <span className="material-symbols-outlined profile-language-caret" aria-hidden="true">
              {languageOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          <div id="profile-language-picker" className={`profile-language-block ${languageOpen ? 'open' : ''}`}>
            <p className="profile-language-label">Translate app content</p>
            <TranslationService variant="inline" />
          </div>

          {user.role === 'patient' ? (
            <>
              <button
                className="profile-menu-item sanctuary-profile-item profile-qr-trigger"
                type="button"
                aria-expanded={shareProfileOpen}
                aria-controls="profile-share-picker"
                onClick={() => {
                  setShareProfileOpen((prev) => !prev);
                  setLanguageOpen(false);
                }}
              >
                <span className="sanctuary-profile-item-icon" aria-hidden="true">
                  <span className="material-symbols-outlined">qr_code_2</span>
                </span>
                <span>Share Profile QR</span>
                <span className="material-symbols-outlined profile-language-caret" aria-hidden="true">
                  {shareProfileOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              <div id="profile-share-picker" className={`profile-share-block ${shareProfileOpen ? 'open' : ''}`}>
                <p className="profile-share-note">Token validity: 12 hours</p>

                {profileShareUrl ? (
                  <div className="profile-share-preview">
                    {profileQrImage ? <img src={profileQrImage} alt="Profile share QR code" loading="lazy" /> : null}
                    {profileQrError ? <p className="profile-share-status">QR preview unavailable on this device. Use the link below.</p> : null}
                    <a href={profileShareUrl} target="_blank" rel="noreferrer">
                      {profileShareUrl}
                    </a>
                  </div>
                ) : null}

                <div className="profile-share-actions" role="group" aria-label="Profile share actions">
                  <button type="button" onClick={createProfileShareQr} disabled={shareProfileBusy}>
                    {shareProfileBusy ? 'Generating...' : profileShareUrl ? 'Regenerate QR' : 'Generate QR'}
                  </button>
                  <button type="button" onClick={copyProfileShareLink} disabled={!profileShareUrl}>
                    Copy Link
                  </button>
                  <button type="button" onClick={shareProfileLink} disabled={!profileShareUrl}>
                    Share
                  </button>
                  <button type="button" onClick={shareProfileOnWhatsApp} disabled={!profileShareUrl}>
                    WhatsApp
                  </button>
                </div>

                {shareProfileMessage ? <p className="profile-share-status">{shareProfileMessage}</p> : null}
              </div>
            </>
          ) : null}

          <button className="profile-menu-item danger sanctuary-profile-item" type="button" onClick={onLogout}>
            <span className="sanctuary-profile-item-icon danger" aria-hidden="true">
              <span className="material-symbols-outlined">logout</span>
            </span>
            <span>Logout</span>
          </button>
        </div>
      </section>

      <form className="journey-profile-form" onSubmit={save}>
        <section className="journey-form-card">
          <div className="journey-form-head">
            <span className="material-symbols-outlined" aria-hidden="true">person</span>
            <h3>Personal Information</h3>
          </div>

          <div className="journey-form-grid two-col">
            <label>
              Full name
              <input name="fullName" defaultValue={user.fullName || ''} required />
            </label>
            <label>
              Phone number
              <input name="phone" defaultValue={user.phone || ''} />
            </label>
            <label>
              Gender
              <input name="gender" defaultValue={user.gender || ''} />
            </label>
            <label>
              Home address
              <input name="address" defaultValue={user.address || ''} />
            </label>
            <label>
              Primary language
              <input name="language" defaultValue={user.language || ''} />
            </label>
            <label>
              Time zone
              <input name="timeZone" defaultValue={user.timeZone || ''} />
            </label>
          </div>
        </section>

        {user.role === 'patient' ? (
          <section className="journey-form-card">
            <div className="journey-form-head">
              <span className="material-symbols-outlined" aria-hidden="true">medical_information</span>
              <h3>Health Information</h3>
            </div>

            <label>
              Chronic conditions
              <textarea name="chronicConditions" defaultValue={user.patientProfile?.chronicConditions || ''} />
            </label>
            <label>
              Basic health info
              <textarea name="basicHealthInfo" defaultValue={user.patientProfile?.basicHealthInfo || ''} />
            </label>
          </section>
        ) : null}

        {user.role === 'doctor' ? (
          <section className="journey-form-card">
            <div className="journey-form-head">
              <span className="material-symbols-outlined" aria-hidden="true">stethoscope</span>
              <h3>Doctor Details</h3>
            </div>

            <div className="journey-form-grid two-col">
              <label>
                Specialization
                <input name="specialization" defaultValue={user.doctorProfile?.specialization || ''} />
              </label>
              <label>
                Years of experience
                <input name="yearsOfExperience" defaultValue={user.doctorProfile?.yearsOfExperience || ''} />
              </label>
              <label>
                Qualifications
                <input name="qualifications" defaultValue={user.doctorProfile?.qualifications || ''} />
              </label>
              <label>
                Clinic
                <input name="clinicName" defaultValue={user.doctorProfile?.clinicName || ''} />
              </label>
              <label>
                Consultation languages
                <input name="consultationLanguages" defaultValue={user.doctorProfile?.consultationLanguages || ''} />
              </label>
            </div>

            <label>
              Description
              <textarea name="description" defaultValue={user.doctorProfile?.description || ''} />
            </label>
          </section>
        ) : null}

        <div className="journey-save-wrap">
          <button type="submit" className="journey-cta secondary full">Save Changes</button>
        </div>
      </form>

      {user.role === 'patient' ? (
        <section className="journey-form-card">
          <div className="journey-form-head">
            <span className="material-symbols-outlined" aria-hidden="true">badge</span>
            <h3>ABHA Profile Link</h3>
          </div>

          <form className="stack" onSubmit={saveAbha}>
            <div className="journey-form-grid two-col">
              <label>
                ABHA ID
                <input
                  value={abhaForm.abhaId}
                  onChange={(event) => setAbhaForm((prev) => ({ ...prev, abhaId: event.target.value }))}
                  required
                />
              </label>

              <label>
                ABHA Address
                <input
                  value={abhaForm.abhaAddress}
                  onChange={(event) => setAbhaForm((prev) => ({ ...prev, abhaAddress: event.target.value }))}
                />
              </label>
            </div>

            <button type="submit" className="journey-cta subtle" disabled={abhaBusy}>
              {abhaBusy ? 'Saving...' : 'Save ABHA Link'}
            </button>
          </form>

          {abhaMessage ? <p className={abhaMessage.toLowerCase().includes('could not') ? 'error' : 'success'}>{abhaMessage}</p> : null}
        </section>
      ) : null}
    </section>
  );
}

function PatientHealthPage() {
  const { data, setData, error, loading } = useApiPage('/api/patients/me');
  const [message, setMessage] = useState('');

  if (loading) return <p className="muted">Loading health profile...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data?.user) return <p className="error">Health profile unavailable.</p>;

  const save = async (event) => {
    event.preventDefault();
    setMessage('');
    const formData = new FormData(event.currentTarget);
    const body = Object.fromEntries(formData.entries());
    const res = await apiRequest('/api/patients/me', { method: 'POST', body });
    if (!res.ok) {
      setMessage(res.data?.error || 'Could not save health profile.');
      return;
    }
    setData(res.data);
    setMessage(res.data?.message || 'Saved.');
  };

  return (
    <section className="card">
      <h2>My health profile</h2>
      <p className="muted">Need medicine information quickly?</p>
      <div className="row-inline wrap">
        <Link className="btn subtle" to="/patients/workspace#medicine-search">
          Search Any Medicine
        </Link>
      </div>
      {message ? <p className={message.toLowerCase().includes('could not') ? 'error' : 'success'}>{message}</p> : null}
      <form className="stack" onSubmit={save}>
        <label>
          Chronic conditions
          <textarea name="chronicConditions" defaultValue={data.user.patientProfile?.chronicConditions || ''} />
        </label>
        <label>
          Basic health info
          <textarea name="basicHealthInfo" defaultValue={data.user.patientProfile?.basicHealthInfo || ''} />
        </label>
        <button type="submit">Save</button>
      </form>
    </section>
  );
}

function PatientWorkspacePage() {
  const { data, error, loading, reload } = useApiPage('/api/patients/workspace');
  const [feedback, setFeedback] = useState('');
  const [medicineSearchOpen, setMedicineSearchOpen] = useState(false);
  const [medicineQuery, setMedicineQuery] = useState('');
  const [medicineSearchBusy, setMedicineSearchBusy] = useState(false);
  const [medicineSearchError, setMedicineSearchError] = useState('');
  const [medicineResults, setMedicineResults] = useState([]);
  const [topMedicineResults, setTopMedicineResults] = useState([]);

  if (loading) return <p className="muted">Loading family and records...</p>;
  if (error) return <p className="error">{error}</p>;
  if (!data?.user) return <p className="error">Family and records unavailable.</p>;

  const uploadDocument = async (event) => {
    event.preventDefault();
    setFeedback('');
    const formData = new FormData(event.currentTarget);
    const res = await apiRequest('/api/documents/upload', { method: 'POST', body: formData });
    if (!res.ok) {
      setFeedback(res.data?.error || 'Upload failed.');
      return;
    }
    setFeedback('Upload complete.');
    event.currentTarget.reset();
  };

  const createFamilyMember = async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const res = await apiRequest('/api/patients/family-members', { method: 'POST', body });
    if (!res.ok) {
      setFeedback(res.data?.error || res.data?.message || 'Unable to add family member.');
      return;
    }
    setFeedback('Family member saved.');
    event.currentTarget.reset();
    reload();
  };

  const updateFamilyMember = async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const res = await apiRequest('/api/patients/family-members/update', { method: 'POST', body });
    if (!res.ok) {
      setFeedback(res.data?.error || res.data?.message || 'Unable to update family member.');
      return;
    }
    setFeedback('Family member updated.');
    reload();
  };

  const printHealthCard = () => {
    window.print();
  };

  const loadTopMedicines = async () => {
    setMedicineSearchBusy(true);
    setMedicineSearchError('');

    const res = await apiRequest('/api/medicines/top?limit=20');
    setMedicineSearchBusy(false);

    if (!res.ok) {
      setMedicineSearchError(res.data?.error || 'Could not load top medicines right now.');
      return;
    }

    setTopMedicineResults(Array.isArray(res.data?.results) ? res.data.results : []);
    setMedicineResults([]);
  };

  const searchMedicines = async (event) => {
    event.preventDefault();
    const query = String(medicineQuery || '').trim();

    if (query.length < 2) {
      setMedicineSearchError('Enter at least 2 characters to search medicines.');
      setMedicineResults([]);
      return;
    }

    setMedicineSearchBusy(true);
    setMedicineSearchError('');

    const res = await apiRequest(`/api/medicines/search?q=${encodeURIComponent(query)}&limit=20`);
    setMedicineSearchBusy(false);

    if (!res.ok) {
      setMedicineSearchError(res.data?.error || 'Could not search medicines right now.');
      setMedicineResults([]);
      return;
    }

    const results = Array.isArray(res.data?.results) ? res.data.results : [];
    setMedicineResults(results);
    if (!results.length) {
      setMedicineSearchError('No medicines matched your search. Try a different spelling.');
    }
  };

  const toggleMedicineSearch = async () => {
    const nextOpen = !medicineSearchOpen;
    setMedicineSearchOpen(nextOpen);
    if (nextOpen && topMedicineResults.length === 0) {
      await loadTopMedicines();
    }
  };

  const latestCompleted = (data.completedAppointments || [])[0] || null;
  const shownMedicines = medicineResults.length ? medicineResults : topMedicineResults;

  return (
    <>
      <section className="journey-hero">
        <h2 className="journey-title">Patient Workspace</h2>
        <p className="journey-sub">Manage your personal profile, family members, and health history in your digital sanctuary.</p>
        <div className="row-inline wrap">
          <button type="button" className="journey-cta secondary" onClick={toggleMedicineSearch}>
            {medicineSearchOpen ? 'Hide Medicine Search' : 'Search Any Medicine'}
          </button>
        </div>
        {feedback ? <p className="journey-status-note">{feedback}</p> : null}
      </section>

      {medicineSearchOpen ? (
        <section className="card medicine-search-card" id="medicine-search">
          <p className="kicker">Health Tool</p>
          <h3>Search Any Medicine (India Top 100)</h3>
          <p className="muted">
            Search medicine names to view common uses and potential side effects. This is educational guidance and does not replace your doctor advice.
          </p>
          <form className="row-inline wrap medicine-search-form" onSubmit={searchMedicines}>
            <input
              value={medicineQuery}
              onChange={(event) => setMedicineQuery(event.target.value)}
              placeholder="Type medicine name (e.g., Metformin)"
              aria-label="Search any medicine"
            />
            <button type="submit" className="journey-cta subtle" disabled={medicineSearchBusy}>
              {medicineSearchBusy ? 'Searching...' : 'Search'}
            </button>
            <button type="button" className="journey-cta subtle" onClick={loadTopMedicines} disabled={medicineSearchBusy}>
              Show Top Medicines
            </button>
          </form>

          {medicineSearchError ? <p className="error">{medicineSearchError}</p> : null}

          {shownMedicines.length ? (
            <div className="medicine-search-results">
              {shownMedicines.map((medicine) => (
                <article className="medicine-search-item" key={`${medicine.id}-${medicine.name}`}>
                  <h4>{medicine.name}</h4>
                  <p className="muted">Generic: {medicine.genericName || 'Not specified'}</p>
                  <p>{medicine.uses || 'No usage summary available.'}</p>
                  <p>
                    <strong>Potential side effects:</strong>{' '}
                    {Array.isArray(medicine.sideEffects) && medicine.sideEffects.length
                      ? medicine.sideEffects.join(', ')
                      : 'Not listed'}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">Tap "Show Top Medicines" to browse or search by name above.</p>
          )}
        </section>
      ) : null}

      <section className="card print-health-card">
        <p className="kicker">Printable summary</p>
        <h3>Patient Health Card</h3>
        <p><strong>Name:</strong> {data.user.fullName}</p>
        <p><strong>Phone:</strong> {data.user.phone || 'Not available'}</p>
        <p><strong>Email:</strong> {data.user.email || 'Not available'}</p>
        <p><strong>Chronic Conditions:</strong> {data.user.patientProfile?.chronicConditions || 'None listed'}</p>
        <p><strong>Basic Health Info:</strong> {data.user.patientProfile?.basicHealthInfo || 'None listed'}</p>
        <p>
          <strong>Latest Consultation:</strong>{' '}
          {latestCompleted ? `${formatPrettyDate(latestCompleted.startAt)} with Dr. ${latestCompleted.doctor?.fullName || 'Doctor'}` : 'No completed visit yet'}
        </p>
        <button type="button" className="journey-cta secondary" onClick={printHealthCard}>
          Print Health Card
        </button>
      </section>

      <section className="journey-workspace-grid">
        <article className="journey-upload-card">
          <div className="journey-form-head">
            <span className="material-symbols-outlined" aria-hidden="true">cloud_upload</span>
            <h3>Upload Medical Document</h3>
          </div>

          <form className="stack" onSubmit={uploadDocument}>
            <label>
              Upload for
              <select name="uploadFor" defaultValue="user" required>
                <option value="user">{data.user.fullName} (Self)</option>
                {(data.user.familyMembers || []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.fullName}
                    {member.relationToPatient ? ` (${member.relationToPatient})` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label>
              File
              <input type="file" name="file" required />
            </label>

            <button type="submit" className="journey-cta">Upload Document</button>
          </form>
        </article>

        <article className="journey-family-sidebar">
          <h3>Family Members</h3>
          {(data.user.familyMembers || []).length === 0 ? <p className="journey-empty-note">No family members yet.</p> : null}
          {(data.user.familyMembers || []).map((member) => (
            <form className="journey-family-card" key={member.id} onSubmit={updateFamilyMember}>
              <input type="hidden" name="familyMemberId" defaultValue={member.id} />
              <div className="journey-family-card-head">
                <h4>{member.fullName}</h4>
                <span>{member.relationToPatient || 'Family'}</span>
              </div>

              <div className="journey-family-grid">
                <label>
                  Full name
                  <input name="fullName" defaultValue={member.fullName || ''} required />
                </label>
                <label>
                  Relation
                  <input name="relationToPatient" defaultValue={member.relationToPatient || ''} />
                </label>
                <label>
                  Gender
                  <input name="gender" defaultValue={member.gender || ''} />
                </label>
                <label>
                  Date of birth
                  <input
                    type="date"
                    name="dateOfBirth"
                    defaultValue={member.dateOfBirth ? new Date(member.dateOfBirth).toISOString().slice(0, 10) : ''}
                  />
                </label>
              </div>

              <label>
                Health info
                <textarea name="basicHealthInfo" defaultValue={member.basicHealthInfo || ''} />
              </label>

              <label>
                Chronic conditions
                <textarea name="chronicConditions" defaultValue={member.chronicConditions || ''} />
              </label>

              <button type="submit" className="journey-cta subtle full">Update</button>
            </form>
          ))}
        </article>
      </section>

      <section className="journey-editorial-card">
        <div className="journey-editorial-copy">
          <h3>Add Family Member</h3>
          <p>
            Ensure everyone in your household gets the best care. Adding family members allows quick appointment booking
            and shared health records.
          </p>
        </div>

        <form className="journey-editorial-form" onSubmit={createFamilyMember}>
          <label>
            Full name
            <input name="fullName" required />
          </label>
          <label>
            Relation
            <input name="relationToPatient" />
          </label>
          <label>
            Gender
            <input name="gender" />
          </label>
          <label>
            Date of birth
            <input type="date" name="dateOfBirth" />
          </label>
          <label className="wide">
            Chronic conditions
            <textarea name="chronicConditions" />
          </label>
          <label className="wide">
            Basic health info
            <textarea name="basicHealthInfo" />
          </label>
          <button type="submit" className="journey-cta secondary wide">Save Family Member</button>
        </form>
      </section>

      <section className="journey-section">
        <div className="journey-section-head">
          <h3>Consultation History</h3>
        </div>

        {(data.completedAppointments || []).length === 0 ? (
          <p className="journey-empty-note">No completed consultations yet.</p>
        ) : null}

        <div className="journey-timeline">
          {(data.completedAppointments || []).map((appointment) => (
            <article className="journey-timeline-item" key={appointment.id}>
              <div className="journey-timeline-dot" aria-hidden="true" />
              <div className="journey-timeline-card">
                <div>
                  <span className="journey-time-pill">{utcDateTime(appointment.startAt)}</span>
                  <h4>{`Consultation with Dr. ${appointment.doctor.fullName}`}</h4>
                  <p>
                    For: {appointment.familyMember ? appointment.familyMember.fullName : data.user.fullName}
                  </p>
                </div>
                <div className="journey-timeline-diagnosis">
                  <p>Diagnosis</p>
                  <strong>{appointment.prescription?.diagnosis || 'No prescription'}</strong>
                </div>
                {appointment.prescription ? (
                  <Link
                    className="journey-cta subtle"
                    to={buildPdfPreviewLink(
                      `/api/prescriptions/${appointment.id}/pdf`,
                      `Prescription ${appointment.id}`,
                      `/api/prescriptions/${appointment.id}/pdf?download=1`,
                      appointment.id
                    )}
                  >
                    Preview PDF
                  </Link>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function RemindersPage() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiPage('/api/reminders');
  const [dispatching, setDispatching] = useState(false);
  const [message, setMessage] = useState('');

  const canDispatch = user.role === 'doctor' || user.role === 'admin';

  const dispatchDue = async () => {
    setDispatching(true);
    setMessage('');

    try {
      const res = await apiRequest('/api/reminders/dispatch', {
        method: 'POST',
        body: { limit: 30 }
      });

      if (!res.ok) {
        setMessage(res.data?.error || 'Unable to dispatch reminders right now.');
        return;
      }

      setMessage(`Dispatch complete. Sent ${res.data?.sent || 0}, failed ${res.data?.failed || 0}.`);
      reload();
    } catch (_err) {
      setMessage('Dispatch failed due to network issues.');
    } finally {
      setDispatching(false);
    }
  };

  if (loading) return <p className="muted">Loading reminders...</p>;
  if (error) return <p className="error">{error}</p>;

  const summary = data?.summary || { scheduled: 0, sent: 0, failed: 0, skipped: 0 };
  const timeline = data?.timeline || [];

  return (
    <section className="compass-shell">
      <header className="compass-hero">
        <p className="kicker">Digital Sanctuary</p>
        <h2>Reminder Compass</h2>
        <p>
          One step at a time. Confirm upcoming nudges, then trigger due reminders when network is available.
        </p>
        <Link className="compass-link-btn" to="/ai-copilot">
          Open AI reminder drafts
        </Link>
      </header>

      {data?.unsupported ? (
        <p className="error">Reminder pipeline is unavailable until the latest Prisma migration is applied.</p>
      ) : null}

      {message ? <p className={message.toLowerCase().includes('failed') ? 'error' : 'success'}>{message}</p> : null}

      <section className="compass-metric-grid">
        <article className="compass-metric-card">
          <h3>Scheduled</h3>
          <strong>{summary.scheduled || 0}</strong>
        </article>
        <article className="compass-metric-card accent">
          <h3>Sent</h3>
          <strong>{summary.sent || 0}</strong>
        </article>
        <article className="compass-metric-card">
          <h3>Failed</h3>
          <strong>{summary.failed || 0}</strong>
        </article>
        <article className="compass-metric-card">
          <h3>Skipped</h3>
          <strong>{summary.skipped || 0}</strong>
        </article>
      </section>

      {canDispatch ? (
        <button type="button" className="compass-action-btn" onClick={dispatchDue} disabled={dispatching || data?.unsupported}>
          <span className="material-symbols-outlined" aria-hidden="true">notifications_active</span>
          {dispatching ? 'Sending...' : 'Send Due Reminders Now'}
        </button>
      ) : (
        <p className="muted">Reminders are sent automatically by your care team.</p>
      )}

      <div className="compass-list">
        {timeline.length === 0 ? <p className="muted">No reminder activity yet.</p> : null}

        {timeline.map((item) => (
          <article className="compass-row" key={item.id}>
            <div className="compass-row-main">
              <h4>
                {user.role === 'patient'
                  ? `Visit with Dr. ${item.appointment?.doctor?.fullName || 'Doctor'}`
                  : `${item.patient?.fullName || 'Patient'} reminder`}
              </h4>
              <p>
                Appointment: {formatPrettyDate(item.appointment?.startAt)} at {formatPrettyTime(item.appointment?.startAt)}
              </p>
              <p>Planned send time: {utcDateTime(item.sendAt)}</p>
            </div>
            <span className={`compass-status-pill ${String(item.status || '').toLowerCase()}`}>{item.status}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function CareSupportPage() {
  const { user } = useSession();
  const { data, error, loading, reload } = useApiPage('/api/support/consents');
  const [feedback, setFeedback] = useState('');

  const addHelper = async (event) => {
    event.preventDefault();
    setFeedback('');

    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const res = await apiRequest('/api/support/helpers', { method: 'POST', body });
    if (!res.ok) {
      setFeedback(res.data?.error || 'Could not save helper details.');
      return;
    }

    setFeedback('Helper profile saved.');
    event.currentTarget.reset();
    reload();
  };

  const grantConsent = async (event) => {
    event.preventDefault();
    setFeedback('');

    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    const res = await apiRequest('/api/support/consents', { method: 'POST', body });
    if (!res.ok) {
      setFeedback(res.data?.error || 'Could not grant consent.');
      return;
    }

    setFeedback('Consent granted and logged.');
    event.currentTarget.reset();
    reload();
  };

  const toggleHelper = async (helper) => {
    setFeedback('');

    const res = await apiRequest(`/api/support/helpers/${helper.id}/toggle`, {
      method: 'POST',
      body: { active: !helper.isActive }
    });

    if (!res.ok) {
      setFeedback(res.data?.error || 'Could not update helper status.');
      return;
    }

    setFeedback(`Helper ${!helper.isActive ? 'activated' : 'deactivated'}.`);
    reload();
  };

  if (loading) return <p className="muted">Loading care support...</p>;
  if (error) return <p className="error">{error}</p>;

  const helpers = data?.helpers || [];
  const activeConsents = data?.activeConsents || [];
  const history = data?.history || [];
  const upcomingAppointments = data?.upcomingAppointments || [];
  const canManage = Boolean(data?.canManage && user.role === 'patient');

  return (
    <section className="compass-shell">
      <header className="compass-hero">
        <p className="kicker">Guided Compass</p>
        <h2>Care Support & Consent</h2>
        <p>Register trusted helpers, then grant clear consent for appointment and records assistance.</p>
        <Link className="compass-link-btn" to="/ai-copilot">
          Generate helper guidance cards
        </Link>
      </header>

      {data?.unsupported ? <p className="error">Care-support tables are missing. Apply the latest migration.</p> : null}
      {feedback ? <p className={feedback.toLowerCase().includes('could not') ? 'error' : 'success'}>{feedback}</p> : null}
      {user.role === 'help_worker' ? <p className="muted">Showing active consent records linked to your helper phone number.</p> : null}

      {canManage ? (
        <div className="compass-two-col">
          <article className="compass-card">
            <h3>Step 1: Add Helper</h3>
            <form className="compass-form" onSubmit={addHelper}>
              <label>
                Helper name
                <input name="helperName" required />
              </label>
              <label>
                Phone number
                <input name="helperPhone" required />
              </label>
              <label>
                Relation
                <input name="relationToPatient" />
              </label>
              <label>
                Village or area
                <input name="village" />
              </label>
              <label>
                Notes
                <textarea name="notes" rows={3} />
              </label>
              <button type="submit" className="compass-action-btn small">Save Helper</button>
            </form>
          </article>

          <article className="compass-card">
            <h3>Step 2: Grant Consent</h3>
            <form className="compass-form" onSubmit={grantConsent}>
              <label>
                Select helper
                <select name="helperId" required defaultValue="">
                  <option value="" disabled>Choose helper</option>
                  {helpers
                    .filter((helper) => helper.isActive)
                    .map((helper) => (
                      <option key={helper.id} value={helper.id}>
                        {helper.helperName} ({helper.helperPhone})
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Consent scope
                <select name="scope" defaultValue="appointment">
                  <option value="appointment">Appointment help</option>
                  <option value="records">Records and documents</option>
                  <option value="all">All supported actions</option>
                </select>
              </label>

              <label>
                Optional appointment
                <select name="appointmentId" defaultValue="">
                  <option value="">Any appointment</option>
                  {upcomingAppointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {formatPrettyDate(appointment.startAt)} - Dr. {appointment.doctor?.fullName}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Notes
                <textarea name="notes" rows={3} />
              </label>

              <button type="submit" className="compass-action-btn small">Grant Consent</button>
            </form>
          </article>
        </div>
      ) : null}

      {canManage ? (
        <article className="compass-card">
          <h3>Helper Directory</h3>
          {(helpers || []).length === 0 ? <p className="muted">No helper profiles yet.</p> : null}
          <div className="compass-list">
            {helpers.map((helper) => (
              <article className="compass-row" key={helper.id}>
                <div className="compass-row-main">
                  <h4>{helper.helperName}</h4>
                  <p>{helper.helperPhone}</p>
                  <p>{helper.relationToPatient || 'Community helper'}</p>
                </div>
                <button type="button" className="compass-toggle-btn" onClick={() => toggleHelper(helper)}>
                  {helper.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </article>
            ))}
          </div>
        </article>
      ) : null}

      <article className="compass-card">
        <h3>Active Consent Log</h3>
        {(activeConsents || []).length === 0 ? <p className="muted">No active consent records.</p> : null}
        <div className="compass-list">
          {activeConsents.map((consent) => (
            <article className="compass-row" key={consent.id}>
              <div className="compass-row-main">
                <h4>
                  {consent.helper?.helperName || consent.patient?.fullName || 'Care helper'} - {consent.scope}
                </h4>
                <p>{consent.notes || 'No notes added.'}</p>
                {consent.appointment ? (
                  <p>
                    Linked appointment: {formatPrettyDate(consent.appointment.startAt)} with Dr.{' '}
                    {consent.appointment.doctor?.fullName}
                  </p>
                ) : null}
              </div>
              <span className="compass-status-pill sent">active</span>
            </article>
          ))}
        </div>
      </article>

      <article className="compass-card">
        <h3>Audit Timeline</h3>
        {(history || []).length === 0 ? <p className="muted">No audit entries yet.</p> : null}
        <div className="compass-list">
          {history.map((entry) => (
            <article className="compass-row" key={entry.id}>
              <div className="compass-row-main">
                <h4>{entry.action}</h4>
                <p>{entry.helper?.helperName || entry.patient?.fullName || 'Care helper context'}</p>
                <p>{utcDateTime(entry.createdAt)}</p>
              </div>
              <span className={`compass-status-pill ${entry.isActive ? 'sent' : 'skipped'}`}>
                {entry.isActive ? 'active' : 'closed'}
              </span>
            </article>
          ))}
        </div>
      </article>
    </section>
  );
}

function DoctorSlotsPage() {
  const { data, error, loading, reload } = useApiPage('/api/doctors/me/slots');
  const [message, setMessage] = useState('');
  const [slotFilter, setSlotFilter] = useState('all');
  const [statusMessage, setStatusMessage] = useState('');
  const [bulkForm, setBulkForm] = useState({
    date: '',
    startHourUtc: '',
    endHourUtc: '',
    action: 'make_available'
  });

  useEffect(() => {
    setStatusMessage(data?.statusMessage || '');
  }, [data?.statusMessage]);

  const setCallState = async (state) => {
    const res = await apiRequest('/api/doctors/me/call-state', {
      method: 'POST',
      body: {
        state,
        statusMessage: state === 'offline' ? statusMessage : ''
      }
    });
    if (!res.ok) {
      setMessage(res.data?.error || 'Unable to change call state.');
      return;
    }
    setMessage(state === 'offline' ? 'Call state changed to offline with availability note.' : `Call state changed to ${state}.`);
    reload();
  };

  const bulkUpdate = async (event) => {
    event.preventDefault();
    const res = await apiRequest('/api/doctors/me/slots/bulk', {
      method: 'POST',
      body: bulkForm
    });
    if (!res.ok) {
      setMessage(res.data?.error || res.data?.message || 'Unable to update slots.');
      return;
    }
    setMessage('Slots updated.');
    reload();
  };

  if (loading) return <p className="muted">Loading slots...</p>;
  if (error) return <p className="error">{error}</p>;

  const slots = data?.slots || [];
  const filteredSlots =
    slotFilter === 'all' ? slots : slots.filter((slot) => String(slot.status || '').toLowerCase() === slotFilter);

  const groupedSlots = filteredSlots.reduce((acc, slot) => {
    const key = new Date(slot.startAt).toISOString().slice(0, 10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(slot);
    return acc;
  }, {});

  const orderedDays = Object.keys(groupedSlots).sort((a, b) => new Date(a) - new Date(b));

  const formatDayLabel = (isoDate) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const toKey = (value) => value.toISOString().slice(0, 10);
    const dateLabel = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    if (toKey(date) === toKey(now)) return `Today - ${dateLabel}`;
    if (toKey(date) === toKey(tomorrow)) return `Tomorrow - ${dateLabel}`;
    return dateLabel;
  };

  return (
    <section className="doctor-slots-shell">
      <header className="doctor-slots-header">
        <h2 className="doctor-slots-title">Availability</h2>
        <p className="doctor-slots-sub">
          Manage your digital clinic presence, update slot windows, and keep consultations organized.
        </p>
      </header>

      {message ? <p className="doctor-slots-flash">{message}</p> : null}

      <div className="doctor-slots-grid">
        <div className="doctor-slots-left">
          <section className="doctor-status-card">
            <div className="doctor-status-top">
              <div>
                <h3>Clinic Status</h3>
                <div className="doctor-status-indicator">
                  <span className={`doctor-status-dot ${data?.callState === 'online' ? 'live' : 'idle'}`} aria-hidden="true" />
                  <span>{data?.callState === 'online' ? 'Currently Online' : 'Currently Offline'}</span>
                </div>
              </div>
              <div className="doctor-status-icon" aria-hidden="true">
                <span className="material-symbols-outlined">
                  {data?.callState === 'online' ? 'cloud_done' : 'cloud_off'}
                </span>
              </div>
            </div>

            <div className="doctor-status-actions">
              <button type="button" className="doctor-go-online" onClick={() => setCallState('online')}>
                <span className="material-symbols-outlined" aria-hidden="true">bolt</span>
                Go Online
              </button>
              <button type="button" className="doctor-go-offline" onClick={() => setCallState('offline')}>
                <span className="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
                Go Offline
              </button>
            </div>

            <label>
              Offline reason (shown to patients)
              <textarea
                value={statusMessage}
                onChange={(event) => setStatusMessage(event.target.value)}
                placeholder="Example: In procedure until 14:30, available for text consults later."
                rows={3}
                maxLength={180}
              />
            </label>
            {data?.statusMessage ? <p className="muted">Current note: {data.statusMessage}</p> : null}
          </section>

          <section className="doctor-bulk-card">
            <h3>Bulk Schedule Update</h3>
            <form className="doctor-bulk-form" onSubmit={bulkUpdate}>
              <label>
                Select Date
                <input
                  type="date"
                  value={bulkForm.date}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, date: e.target.value }))}
                  required
                />
              </label>

              <div className="doctor-bulk-time-grid">
                <label>
                  Start Hour (UTC)
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={bulkForm.startHourUtc}
                    onChange={(e) => setBulkForm((prev) => ({ ...prev, startHourUtc: e.target.value }))}
                  />
                </label>

                <label>
                  End Hour (UTC)
                  <input
                    type="number"
                    min="1"
                    max="24"
                    value={bulkForm.endHourUtc}
                    onChange={(e) => setBulkForm((prev) => ({ ...prev, endHourUtc: e.target.value }))}
                  />
                </label>
              </div>

              <label>
                Action Type
                <select
                  value={bulkForm.action}
                  onChange={(e) => setBulkForm((prev) => ({ ...prev, action: e.target.value }))}
                >
                  <option value="make_available">Make Available</option>
                  <option value="make_busy">Make Busy</option>
                </select>
              </label>

              <button type="submit" className="doctor-bulk-submit">Apply Changes</button>
            </form>
          </section>
        </div>

        <section className="doctor-upcoming-card">
          <div className="doctor-upcoming-head">
            <h3>Upcoming Slots</h3>
            <div className="doctor-filter-wrap">
              <span className="material-symbols-outlined" aria-hidden="true">filter_list</span>
              <select value={slotFilter} onChange={(e) => setSlotFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="available">Available</option>
                <option value="booked">Booked</option>
                <option value="busy">Busy</option>
              </select>
            </div>
          </div>

          {filteredSlots.length === 0 ? <p className="journey-empty-note">No slots found for this filter.</p> : null}

          <div className="doctor-slot-list">
            {orderedDays.map((dayKey) => (
              <div key={dayKey} className="doctor-slot-day-group">
                <div className="doctor-slot-day-head">
                  <span>{formatDayLabel(dayKey)}</span>
                  <div aria-hidden="true" />
                </div>

                {groupedSlots[dayKey]
                  .slice()
                  .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
                  .map((slot) => {
                    const status = String(slot.status || 'unknown').toLowerCase();
                    return (
                      <article className={`doctor-slot-row ${status}`} key={slot.id}>
                        <div className="doctor-slot-main">
                          <div className="doctor-slot-icon" aria-hidden="true">
                            <span className="material-symbols-outlined">
                              {status === 'booked' ? 'person' : 'calendar_today'}
                            </span>
                          </div>
                          <div>
                            <p className="doctor-slot-time">{utcDateTime(slot.startAt).slice(11, 16)} UTC</p>
                            <p className="doctor-slot-meta">
                              {status === 'booked' ? 'Reserved consultation slot' : 'Open for booking'}
                            </p>
                          </div>
                        </div>

                        <span className={`doctor-slot-badge ${status}`}>{status}</span>
                      </article>
                    );
                  })}
              </div>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function DoctorAnalyticsPage() {
  const { data, error, loading } = useApiPage('/api/doctors/me/analytics');

  if (loading) return <p className="muted">Loading analytics...</p>;
  if (error) return <p className="error">{error}</p>;

  const dailySeries = data?.dailySeries || [];
  const statusCounts = data?.statusCounts || {};
  const weeklyDigest = data?.weeklyDigest || {};

  const maxCount = Math.max(1, ...dailySeries.map((entry) => entry.count || 0));
  const peakDay = dailySeries.reduce(
    (best, entry) => ((entry.count || 0) > (best.count || 0) ? entry : best),
    dailySeries[0] || { day: 'N/A', count: 0 }
  );

  const formatOrdinalDay = (isoDate) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    const day = date.getDate();
    const j = day % 10;
    const k = day % 100;
    let suffix = 'th';
    if (j === 1 && k !== 11) suffix = 'st';
    else if (j === 2 && k !== 12) suffix = 'nd';
    else if (j === 3 && k !== 13) suffix = 'rd';
    return `${day}${suffix}`;
  };

  const rangeLabel =
    dailySeries.length > 1
      ? `${new Date(dailySeries[0].day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${new Date(
          dailySeries[dailySeries.length - 1].day
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Current week';

  return (
    <section className="doctor-analytics-shell">
      <header className="doctor-analytics-header">
        <h2 className="doctor-analytics-title">Doctor Analytics</h2>
        <p className="doctor-analytics-sub">Last 7 days activity snapshot.</p>
      </header>

      <section className="doctor-metric-grid">
        <article className="doctor-metric-card">
          <div className="doctor-metric-top">
            <span className="material-symbols-outlined" aria-hidden="true">event_note</span>
            <span className="doctor-metric-chip positive">Booked</span>
          </div>
          <strong>{statusCounts.booked || 0}</strong>
          <p>Booked</p>
        </article>

        <article className="doctor-metric-card highlight">
          <div className="doctor-metric-top">
            <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
            <span className="doctor-metric-chip">Optimal</span>
          </div>
          <strong>{statusCounts.completed || 0}</strong>
          <p>Completed</p>
        </article>

        <article className="doctor-metric-card">
          <div className="doctor-metric-top">
            <span className="material-symbols-outlined" aria-hidden="true">cancel</span>
            <span className="doctor-metric-chip warn">Monitor</span>
          </div>
          <strong>{statusCounts.cancelled || 0}</strong>
          <p>Cancelled</p>
        </article>

        <article className="doctor-metric-card">
          <div className="doctor-metric-top">
            <span className="material-symbols-outlined" aria-hidden="true">person_off</span>
            <span className="doctor-metric-chip danger">No-show</span>
          </div>
          <strong>{statusCounts.no_show || 0}</strong>
          <p>No-show</p>
        </article>
      </section>

      <section className="card">
        <h3>Weekly feedback digest</h3>
        <div className="grid cards">
          <MetricCard label="Average rating" value={weeklyDigest.averageRating ?? 0} />
          <MetricCard label="Review count" value={weeklyDigest.reviewCount ?? 0} />
          <MetricCard label="Re-book rate" value={`${weeklyDigest.rebookRate ?? 0}%`} />
          <MetricCard label="Completed consults" value={weeklyDigest.completedConsults ?? 0} />
        </div>
        {(weeklyDigest.topFeedbackKeywords || []).length ? (
          <p className="muted" style={{ marginTop: '0.6rem' }}>
            Common themes:{' '}
            {weeklyDigest.topFeedbackKeywords
              .map((item) => `${item.word} (${item.count})`)
              .join(', ')}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: '0.6rem' }}>No review keywords yet for this week.</p>
        )}
      </section>

      <section className="doctor-chart-card">
        <div className="doctor-chart-head">
          <div>
            <h3>Daily Appointments</h3>
            <p>Frequency of patient consultations over the past week.</p>
          </div>
          <div className="doctor-chart-range">
            <span className="material-symbols-outlined" aria-hidden="true">calendar_month</span>
            <span>{rangeLabel}</span>
          </div>
        </div>

        <div className="doctor-bar-chart" role="img" aria-label="Daily appointments bar chart">
          {dailySeries.map((entry) => {
            const heightPct = Math.max(6, Math.round(((entry.count || 0) / maxCount) * 100));
            const isPeak = entry.day === peakDay.day;
            return (
              <div className="doctor-bar-col" key={entry.day}>
                <span className="doctor-bar-value">{entry.count}</span>
                <div className={`doctor-bar ${isPeak ? 'peak' : ''}`} style={{ height: `${heightPct}%` }} />
                <span className={`doctor-bar-label ${isPeak ? 'peak' : ''}`}>{formatOrdinalDay(entry.day)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="doctor-insights-grid">
        <article className="doctor-insight-main">
          <h3>Patient Engagement Growth</h3>
          <p>
            Peak consultation volume was on {formatOrdinalDay(peakDay.day)} with {peakDay.count} appointments.
            Consistent completion trends suggest your current slot cadence is working well.
          </p>
          <a className="journey-cta secondary" href="#" onClick={(event) => event.preventDefault()}>
            Download Report
          </a>
        </article>

        <article className="doctor-insight-alert">
          <h3>Action Alert</h3>
          <p>
            {statusCounts.cancelled || 0} consultations were cancelled this week. Consider enabling reminder nudges to
            reduce drop-offs.
          </p>
          <a className="doctor-insight-link" href="#" onClick={(event) => event.preventDefault()}>
            Manage Reminders
            <span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
          </a>
        </article>
      </section>
    </section>
  );
}

export default App;

