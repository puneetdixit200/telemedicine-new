import React from 'react';
import { Link } from 'react-router-dom';
import { getPatientNotificationLabels } from './patientNotificationLabels';

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ROUTE_PATTERN = /(?:https?:\/\/[^\s)]+|\/book\?[^\s)]+)/gi;
const QUERY_REFERENCE_PATTERN = /\b(?:doctorId|appointmentId|fromAppointmentId|runId|traceId|actionId|messageDraftId)=[^\s&]+&?/gi;

export function isAllowedPatientNotificationPath(path) {
  const value = String(path || '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (/^(?:javascript|data|vbscript):/i.test(value)) return false;
  return value.startsWith('/book') || value.startsWith('/appointments/');
}

export function sanitizePatientNotificationText(value) {
  return String(value || '')
    .replace(ROUTE_PATTERN, '')
    .replace(QUERY_REFERENCE_PATTERN, '')
    .replace(UUID_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

export default function PatientNotificationBanner({ notifications, minimized, onMinimize, onDismiss }) {
  const primary = notifications[0];
  if (!primary) return null;

  const metadata = primary.metadata || {};
  const direction = metadata.languageDirection === 'rtl' ? 'rtl' : 'ltr';
  const labels = getPatientNotificationLabels(metadata.languageCode);
  const isNoShowRecovery = metadata.type === 'agent_no_show_recovery';
  const trustedRebookPath = isAllowedPatientNotificationPath(metadata.quickRebookPath) ? metadata.quickRebookPath : '';
  const fallbackAppointmentPath = primary.appointmentId ? `/appointments/${primary.appointmentId}` : '';
  const actionPath = trustedRebookPath || fallbackAppointmentPath;
  const slots = Array.isArray(metadata.availableSlotLabels) ? metadata.availableSlotLabels.filter(Boolean).slice(0, 3) : [];
  const visibleTitle = sanitizePatientNotificationText(primary.title || metadata.notificationTitle || labels.category);
  const visibleBody = sanitizePatientNotificationText(primary.body);

  return (
    <aside
      className={`patient-notification-banner ${minimized ? 'minimized' : ''}`}
      aria-live="polite"
      aria-label={labels.category}
      dir={direction}
    >
      <button type="button" className="patient-notification-toggle" onClick={onMinimize}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {minimized ? 'notifications_active' : 'expand_more'}
        </span>
        <span>{minimized ? `${notifications.length} ${labels.category}` : labels.minimize}</span>
      </button>

      {!minimized ? (
        <div className="patient-notification-content">
          <div className="patient-notification-icon">
            <span className="material-symbols-outlined" aria-hidden="true">notifications_active</span>
          </div>
          <div className="patient-notification-copy">
            <small className="patient-notification-category">{labels.category}</small>
            <strong>{visibleTitle}</strong>
            <p>{visibleBody}</p>
            {slots.length ? (
              <div className="patient-notification-slots" aria-label={labels.available}>
                <small>{labels.available}</small>
                <div>
                  {slots.map((slot) => <span key={slot}>{slot}</span>)}
                </div>
              </div>
            ) : null}
            <div className="patient-notification-actions">
              {actionPath ? (
                <Link to={actionPath}>
                  {isNoShowRecovery ? labels.rebook : labels.open}
                </Link>
              ) : null}
              <button type="button" onClick={() => onDismiss(primary.id)}>
                {labels.dismiss}
              </button>
            </div>
            {notifications.length > 1 ? <small>{notifications.length - 1} {labels.more}.</small> : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
