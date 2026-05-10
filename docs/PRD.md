# Product Requirements Document (PRD)

## 1. Document Metadata

- Product: Telemedicine Rural App
- Version: 1.3
- Date: 2026-04-11
- Status: Active implementation-aligned PRD
- Platforms: Web (primary), Capacitor wrapper readiness (secondary)

## 2. Product Summary

Telemedicine Rural App provides role-based virtual care workflows for patient consultation, doctor operations, delegated support, and administrative impact tracking. The product is optimized for mixed-connectivity environments and emphasizes guided interactions over complex dashboard density.

Core outcomes:
- Faster consultation access for patients
- Safe and auditable role-based record access
- Reliable appointment-to-prescription continuity
- Operational visibility for quality and follow-up

## 3. Problem Statement

Target users in rural and low-resource contexts face barriers including:
- Limited access to specialists
- Unstable connectivity during consultations
- Fragmented records and family-care coordination
- Difficulty navigating complex health apps

The product addresses this by combining guided booking, reliable tele-consult flows, shared care support, and follow-up workflows.

## 4. Users and Roles

## 4.1 Patient

Needs:
- Find doctor quickly
- Book and attend consultation
- Access prescriptions and medicine guidance
- Manage family records

## 4.2 Doctor

Needs:
- Manage slots and call availability
- Access patient context safely
- Complete prescriptions and follow-ups
- View analytics and outcomes

## 4.3 Help Worker

Needs:
- Assist patient journeys under explicit consent
- Access only delegated scope
- Track reminders and appointment support

## 4.4 Admin

Needs:
- Monitor system and impact KPIs
- Support operational readiness and quality workflows

## 5. Product Principles

1. Guided and understandable interactions
2. Safe defaults and role-appropriate access
3. Mobile-first practical design
4. Graceful degradation under weak network conditions
5. AI as draft assistant, not autonomous decision engine

## 6. In-Scope Functional Areas

## 6.1 Authentication and session

- Login, register, logout
- Role-aware protected routes
- Session context API for app bootstrap

## 6.2 Doctor discovery and booking

- Doctor list and profile views
- Slot-aware appointment booking
- Consultation mode selection (video/audio/text)
- Family member booking support

## 6.3 Appointment lifecycle

- Upcoming/history timeline
- Presence and readiness checks
- Pre-consult notes and review submission
- Cancel/end actions
- No-show follow-up flow

## 6.4 Consultation and call workflows

- Call join/end controls
- Supabase Realtime signaling
- Chat fallback path
- Ending the call from one participant immediately exits the other participant
- Connection-aware usability support

## 6.5 Prescription and medicine workflows

- Doctor-owned prescription create/update
- PDF generation and preview
- Handoff code support
- Patient medicine cabinet and medicine search

## 6.6 Documents and reports

- File upload and role-scoped access
- Document preview and download
- Lab report linkage

## 6.7 Pharmacy and labs

- Pharmacy order create/list/update
- Lab catalog and order lifecycle
- Report attachment and status tracking

## 6.8 Reminders and follow-up

- Reminder scheduling and dispatch
- Refill reminder support
- Timeline visibility by role

## 6.9 Care support and consent

- Helper creation and toggle
- Scoped consent grant/revocation
- Consent audit trail

## 6.10 AI assistance

- Context endpoint and clinical drafting utilities
- Reminder, referral, and async response drafts
- Translation support
- Review-required metadata policy

## 6.11 Innovation workflows

- Vitals and trends
- Care plans and check-ins
- Emergency escalation
- External consult threads
- Voice notes and second opinions
- Patient QR token sharing and doctor/admin access-by-token

## 7. Out of Scope

- Insurance claims and payment settlement
- Native-only feature parity for iOS/Android
- Autonomous diagnosis/treatment recommendations
- Full EHR interoperability standards implementation

## 8. UX Requirements

## 8.1 Navigation requirements

- Search-only top navigation in authenticated shell
- Bottom mobile dock with Home, Visits, AI Help, Profile
- Profile action center includes controls previously in top menu

## 8.2 AI Help requirements

- AI Help opens in button-first mode
- Feature forms appear only after feature selection
- Draft outputs marked as review-required

## 8.3 Mobile behavior requirements

- Core actions must remain visible and tap-friendly
- Buttons and primary controls must keep a minimum 44px mobile tap target
- Data-heavy screens should collapse to one-column cards or scrollable table wrappers on narrow viewports
- Bottom-fixed utility widgets must not conflict with mobile dock
- Connectivity/translation fixed widgets are hidden on mobile where needed

## 9. API Requirements

- All protected routes require auth middleware
- `/api` and `/api/v1` route compatibility maintained
- Structured API errors include stable error code payloads
- Health routes provide live and ready checks

## 10. Security and Privacy Requirements

- Role and ACL checks on protected resources
- Consent-bound helper visibility
- Secure cookie auth handling in production
- CSP and request throttling middleware enabled
- Environment secrets must remain outside source control

## 11. Non-Functional Requirements

- Reliability: health probes and graceful startup checks
- Performance: static asset cache control with immutable hashed bundles
- Observability: request IDs and structured logs
- Maintainability: grouped domain controllers/routes
- Deployability: startup script with migration and build safeguards

## 12. Acceptance Criteria (Release Baseline)

A release is accepted when all criteria below are met:

1. Authentication and role access
- Login/register/logout flows are functional
- Protected routes reject unauthorized access

2. Booking to prescription path
- Patient can book, join, complete visit, and view prescription PDF

3. Doctor operational path
- Doctor can manage slots, complete prescription, and review analytics

4. Delegation and support
- Consent-scoped helper flow works with proper revocation behavior

5. Orders and reports
- Pharmacy and lab order flows work with status updates and report linkage

6. AI safety baseline
- AI outputs include review-required labeling in UI and payload metadata

7. Reliability checks
- `/api/health/live` and `/api/health/ready` function as expected

8. Build and tests
- `npm test` passes
- `npm run frontend:build` passes

## 13. Success Metrics

Product KPIs:
- Booking conversion rate
- Appointment completion rate
- No-show rate and no-show recovery rate
- Re-book rate from completed visits
- Prescription handoff completion ratio

Operational KPIs:
- Readiness uptime
- Reminder dispatch success ratio
- Lab/pharmacy order completion cycle time
- Review coverage ratio
- Active helper-link count under consent

## 14. Risks and Mitigations

1. Connectivity instability
- Mitigation: mode flexibility, chat fallback, resilient UX messaging

2. Over-permissioned access
- Mitigation: role checks, consent scope, audit records

3. AI misuse
- Mitigation: draft-only messaging, review-required policy, restricted feature actions by role

4. Deployment misconfiguration
- Mitigation: startup guards, health probes, production checklist

## 15. Release Phases

Phase 1: Core reliability and UX consistency
- Harden booking, appointment, prescription, and profile action flows

Phase 2: Operational hardening
- Improve observability and release automation confidence

Phase 3: Expansion
- Extend localization depth and workflow automation with safety controls

## 16. Dependencies and References

- Architecture and setup: `README.md`
- Design specification: `design.md`
- Production launch checklist: `docs/production-readiness.md`
- Azure deployment details: `azure-deploy.md`
- Schema source: `prisma/schema.prisma`
- API baseline: `docs/openapi.yaml`
