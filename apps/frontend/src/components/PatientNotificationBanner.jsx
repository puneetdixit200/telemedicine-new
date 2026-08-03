import React from 'react';
import { Link } from 'react-router-dom';

export default function PatientNotificationBanner({ notifications, minimized, onMinimize, onDismiss }) {
  const primary = notifications[0];
  if (!primary) return null;

  const direction = primary.metadata?.languageDirection === 'rtl' ? 'rtl' : 'ltr';
  return (
    <aside className={`patient-notification-banner ${minimized ? 'minimized' : ''}`} aria-live="polite" dir={direction}>
      <button type="button" className="patient-notification-toggle" onClick={onMinimize}>
        <span className="material-symbols-outlined" aria-hidden="true">
          {minimized ? 'notifications_active' : 'expand_more'}
        </span>
        <span>{minimized ? `${notifications.length} care update${notifications.length > 1 ? 's' : ''}` : 'Minimize'}</span>
      </button>

      {!minimized ? (
        <div className="patient-notification-content">
          <div className="patient-notification-icon">
            <span className="material-symbols-outlined" aria-hidden="true">notifications_active</span>
          </div>
          <div>
            <strong>{primary.title || primary.metadata?.notificationTitle || 'Care update from your clinic'}</strong>
            <p>{primary.body}</p>
            <div className="patient-notification-actions">
              {primary.appointmentId ? <Link to={`/appointments/${primary.appointmentId}`}>Open appointment</Link> : null}
              <button type="button" onClick={() => onDismiss(primary.id)}>
                Dismiss
              </button>
            </div>
            {notifications.length > 1 ? <small>{notifications.length - 1} more update(s) waiting.</small> : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
