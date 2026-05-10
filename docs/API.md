# API Reference

This document lists the active HTTP endpoints currently wired in the backend route layer.

Base prefixes:
- /api
- /api/v1

Notes:
- All routes below are available under both prefixes unless explicitly stated.
- Auth means cookie-based authenticated session is required.
- Role means additional role guard is enforced.

## 1. Session and Health

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /session | No | None | Returns current session context (user or null). |
| GET | /health/live | No | None | Liveness probe. |
| GET | /health/ready | No | None | Readiness probe including DB checks. |

## 2. Auth

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /auth/login | No | None | Login page route support. |
| POST | /auth/login | No | None | Authenticate user and start session. |
| POST | /auth/session-location | Yes | Any | Save session-linked location for logged-in user. |
| GET | /auth/register | No | None | Register page route support. |
| POST | /auth/register | No | None | Register new account. |
| POST | /auth/logout | No | None | Clear session cookie/logout user. |

## 3. Users and Presence

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| POST | /users/presence/ping | Yes | Any | Presence heartbeat update. |
| GET | /users/presence/status | Yes | Any | Presence status lookup. |
| GET | /users/me | Yes | Any | View current user profile. |
| POST | /users/me | Yes | Any | Update current user profile. |

## 4. Doctors

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /doctors | Yes | Any | List/search doctors. |
| GET | /doctors/me/slots | Yes | doctor | View doctor slots. |
| GET | /doctors/me/analytics | Yes | doctor | Doctor analytics dashboard data. |
| POST | /doctors/me/call-state | Yes | doctor | Set doctor online/offline call availability. |
| POST | /doctors/me/slots/bulk | Yes | doctor | Bulk create/update slot availability. |
| GET | /doctors/:doctorId | Yes | Any | View doctor profile/details. |

## 5. Patients

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /patients/me | Yes | patient | View patient health profile. |
| POST | /patients/me | Yes | patient | Update patient health profile. |
| GET | /patients/workspace | Yes | patient | Patient workspace summary. |
| POST | /patients/family-members | Yes | patient | Create family member profile. |
| POST | /patients/family-members/update | Yes | patient | Update family member profile. |

## 6. Appointments

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /appointments | Yes | Any | List appointments visible to current user. |
| GET | /appointments/impact | Yes | Any | Impact dashboard metrics. |
| GET | /appointments/:appointmentId | Yes | Any | View appointment detail with ACL checks. |
| GET | /appointments/:appointmentId/presence | Yes | Any | Presence/readiness detail for appointment. |
| POST | /appointments/book | Yes | patient | Book an appointment. |
| POST | /appointments/:appointmentId/prep | Yes | patient | Save/update patient pre-consult input. |
| POST | /appointments/:appointmentId/review | Yes | patient | Submit consultation review. |
| POST | /appointments/:appointmentId/cancel | Yes | Any | Cancel appointment with ACL checks. |
| POST | /appointments/:appointmentId/end | Yes | Any | End appointment. |
| POST | /appointments/:appointmentId/no-show-followup | Yes | Any | Mark no-show and draft follow-up path. |

## 7. Calls

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /calls/:appointmentId | Yes | Any | Call session context for appointment. |
| POST | /calls/:appointmentId/end | Yes | Any | End call session. |

Consultation rooms use Supabase Realtime in the browser for WebRTC signaling, text chat, and `call_ended` broadcasts. The REST end route remains the durable server-side session close.

## 8. Prescriptions and Medicines

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /prescriptions/catalog/search | Yes | Any | Search medicine guidance blended with scoped history. |
| GET | /prescriptions/:appointmentId | Yes | Any | View prescription by appointment ACL. |
| POST | /prescriptions/:appointmentId | Yes | doctor | Create or update prescription. |
| GET | /prescriptions/:appointmentId/pdf | Yes | Any | Download/stream prescription PDF. |
| GET | /medicines/top | Yes | Any | List top curated medicine catalog entries. |
| GET | /medicines/search | Yes | Any | Search curated medicine catalog. |

## 9. Documents

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| POST | /documents/upload | Yes | Any | Upload document for patient/family context. |
| GET | /documents/:documentId/preview | Yes | Any | Inline preview for PDF documents. |
| GET | /documents/:documentId/download | Yes | Any | Generate authorized download response. |
| GET | /documents/local/:blobName(*) | Yes | Any | Local-mode document download route (when enabled). |

## 10. Pharmacy

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /pharmacy/orders | Yes | Any | List pharmacy orders visible to current user. |
| POST | /pharmacy/orders | Yes | Any | Create pharmacy order. |
| GET | /pharmacy/orders/:orderId | Yes | Any | View pharmacy order detail. |
| POST | /pharmacy/orders/:orderId/status | Yes | Any | Update pharmacy order status with ACL checks. |

## 11. Labs

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /labs/catalog | Yes | Any | List active test catalog. |
| POST | /labs/catalog | Yes | Any | Create/update catalog test (controller-enforced role logic). |
| GET | /labs/orders | Yes | Any | List lab orders visible to current user. |
| POST | /labs/orders | Yes | Any | Create lab order. |
| GET | /labs/orders/:orderId | Yes | Any | View lab order detail. |
| POST | /labs/orders/:orderId/status | Yes | Any | Update lab order status. |
| POST | /labs/orders/:orderId/report | Yes | Any | Attach report document to lab order. |

## 12. Reminders

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /reminders | Yes | Any | List reminders by role visibility. |
| POST | /reminders/dispatch | Yes | doctor,admin | Dispatch due reminders now. |

## 13. Support and Consent

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /support/consents | Yes | Any | List active/revoked support consents by viewer context. |
| POST | /support/helpers | Yes | Any | Create helper record. |
| POST | /support/helpers/:helperId/toggle | Yes | Any | Activate/deactivate helper link. |
| POST | /support/consents | Yes | Any | Grant or update delegated consent scope. |

## 14. AI

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /ai/context | Yes | Any | Shared context payload for AI features. |
| POST | /ai/draft-note | Yes | Any | Generate doctor note draft. |
| POST | /ai/visit-summary | Yes | Any | Generate consultation summary draft. |
| POST | /ai/simplify-medication | Yes | Any | Simplify medication instructions. |
| POST | /ai/prescription-simplify | Yes | Any | Alias endpoint for prescription simplification. |
| POST | /ai/triage-assist | Yes | Any | Triage assistance draft. |
| POST | /ai/reminder-text | Yes | Any | Reminder draft generation. |
| POST | /ai/reminder-message | Yes | Any | Alias endpoint for reminder text. |
| POST | /ai/referral-summary | Yes | Any | Referral summary draft. |
| POST | /ai/async-reply-suggest | Yes | Any | Async reply suggestion draft. |
| POST | /ai/document-assist | Yes | Any | Document assistant draft output. |
| POST | /ai/helper-guidance | Yes | Any | Helper guidance draft. |
| POST | /ai/translate-chat | Yes | Any | Chat translation helper. |

## 15. Innovations

| Method | Path | Auth | Role | Purpose |
| --- | --- | --- | --- | --- |
| GET | /innovations/public/records/:token | No | None | Public token-based record view. |
| POST | /innovations/voice/intent | Yes | Any | Voice intent parser endpoint. |
| POST | /innovations/triage/preview | Yes | Any | Triage preview draft. |
| POST | /innovations/appointments/:appointmentId/vitals | Yes | Any | Record consultation vitals. |
| GET | /innovations/appointments/:appointmentId/vitals | Yes | Any | List consultation vitals. |
| POST | /innovations/patients/qr-token | Yes | Any | Create patient profile share token. |
| GET | /innovations/patients/:patientId/full-details | Yes | Any | Full patient detail lookup by patient ID. |
| GET | /innovations/patients/access-by-token/:token | Yes | Any | Full patient detail lookup by share token. |
| POST | /innovations/patients/:patientId/care-plans | Yes | Any | Create care plan. |
| GET | /innovations/patients/:patientId/care-plans | Yes | Any | List care plans. |
| POST | /innovations/care-plans/:planId/check-ins | Yes | Any | Add care plan check-in. |
| POST | /innovations/emergency/ambulance | Yes | Any | Quick ambulance escalation request. |
| POST | /innovations/appointments/:appointmentId/emergency | Yes | Any | Escalate appointment emergency. |
| GET | /innovations/emergencies | Yes | Any | List emergencies by visibility. |
| POST | /innovations/appointments/:appointmentId/external-thread | Yes | Any | Create/update external consult thread. |
| POST | /innovations/external-threads/:threadId/messages | Yes | Any | Post message to external thread. |
| GET | /innovations/external-threads/:threadId/messages | Yes | Any | List external thread messages. |
| POST | /innovations/appointments/:appointmentId/voice-notes | Yes | Any | Create consultation voice note. |
| GET | /innovations/appointments/:appointmentId/voice-notes | Yes | Any | List consultation voice notes. |
| GET | /innovations/patients/:patientId/trends | Yes | Any | Patient trends aggregation. |
| GET | /innovations/patients/:patientId/refill-reminders | Yes | Any | Refill reminder timeline summary. |
| POST | /innovations/patients/me/abha | Yes | Any | Link patient ABHA details. |
| GET | /innovations/patients/me/abha | Yes | Any | Get patient ABHA details. |
| POST | /innovations/appointments/:appointmentId/second-opinions | Yes | Any | Create second opinion request. |
| GET | /innovations/appointments/:appointmentId/second-opinions | Yes | Any | List second opinions by appointment. |
| POST | /innovations/second-opinions/:requestId/status | Yes | Any | Update second opinion status. |
| GET | /innovations/doctors/:doctorId/trust-score | Yes | Any | Doctor trust-score summary. |
| POST | /innovations/offline/sync | Yes | Any | Sync offline client queue payloads. |

## 16. Contract References

- Baseline OpenAPI examples: docs/openapi.yaml
- Full route wiring: apps/backend/routes
- Controllers and behavior: apps/backend/controllers
