# Telemedicine Rural App

Production-style telemedicine platform built with Express, Prisma, PostgreSQL, Socket.IO, and a React SPA.

This repository contains:
- Role-based telemedicine workflows for patients, doctors, help workers, and admins
- Real-time consultation support (video/audio/text signaling and chat)
- Prescription, pharmacy, lab, reminders, and document workflows
- AI-assisted draft tooling with review-required policy
- Azure-ready deployment flow and Capacitor mobile wrapper scaffolding

## 1. Product Scope

The system is designed for mixed-connectivity and rural-first usage patterns:
- Patient booking and consultation lifecycle
- Doctor slot and analytics management
- Delegated care support through explicit consent
- Document and prescription handoff via secure access controls
- Operations visibility with impact and readiness metrics

## 2. Technology Stack

- Backend: Node.js, Express (CommonJS)
- Database: PostgreSQL via Prisma ORM
- Frontend: React + React Router + Vite
- Realtime: Socket.IO
- Storage: Azure Blob Storage (with configurable local fallback)
- Auth: Cookie-based JWT session
- Security: Helmet, rate limiting, role authorization
- Testing: Jest + Supertest

## 3. Repository Layout

```text
.
|- app.js
|- apps/
|  |- backend/
|  |  |- controllers/
|  |  |- middleware/
|  |  |- models/
|  |  |- routes/
|  |  |- server/
|  |  |- services/
|  |- frontend/
|     |- src/
|- docs/
|- prisma/
|- scripts/
|- tests/
|- azure-deploy.md
|- design.md
|- docs/PRD.md
|- docs/production-readiness.md
|- docs/CAPACITOR.md
```

## 4. Prerequisites

- Node.js 20+
- PostgreSQL 14+
- npm 10+
- Optional: Docker (for local postgres container)

## 5. Quick Start

### 5.1 One-command startup (Windows)

```bat
run-app.bat
```

### 5.2 Manual startup

```bash
copy .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

App URLs:
- API + SPA server: http://localhost:3000
- Frontend-only dev server (optional): http://localhost:5173 via `npm run frontend:dev`

## 6. Environment Variables

Reference file: `.env.example`

### 6.1 Required in all environments

- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

### 6.2 Network and CORS

- `APP_BASE_URL` (comma-separated allowed web origins)
- `ALLOW_NO_ORIGIN_SOCKET` (default `false`)

### 6.3 Storage

- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER` (default `patient-documents`)
- `AZURE_STORAGE_PUBLIC_BASE_URL`
- `AZURE_UPLOADS_MODE` (`azure-only`, `local-only`, etc.)

### 6.4 AI

- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL` (default `llama3.1:8b`)
- `OLLAMA_TIMEOUT_MS` (default `45000`)
- `AI_RATE_LIMIT_PER_MINUTE` (default `40`)

### 6.5 Operations

- `APPLICATIONINSIGHTS_CONNECTION_STRING` (optional)
- `ENABLE_REMINDER_CRON` (`true` to auto-dispatch)
- `REMINDER_CRON_INTERVAL_MS`
- `REMINDER_CRON_BATCH_LIMIT`
- `LOG_LEVEL`

### 6.6 Security and administration

- `ADMIN_INVITE_CODE` (optional)

## 7. Seeded Accounts

After `npm run db:seed`:

- Patient: `patient1@example.com` / `Password123!`
- Patient: `patient2@example.com` / `Password123!`
- Doctor: `doctor1@example.com` / `Password123!`
- Doctor: `doctor2@example.com` / `Password123!`
- Admin: `admin@example.com` / `Password123!`
- Help worker: `helper1@example.com` / `Password123!`

## 8. NPM Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start backend app with nodemon |
| `npm start` | Production startup (`prestart` + server) |
| `npm run start:azure` | Explicit Azure startup script |
| `npm run frontend:dev` | Start Vite dev server |
| `npm run frontend:build` | Build frontend bundle |
| `npm run frontend:preview` | Preview built frontend |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run db:migrate` | Prisma dev migration |
| `npm run db:deploy` | Prisma deploy migration |
| `npm run db:seed` | Seed baseline users and data |
| `npm run test` | Jest suite |
| `npm run ci` | Lint + test + prisma generate + frontend build |
| `npm run mobile:build` | Build web bundle for Capacitor |
| `npm run mobile:sync` | Build and sync Capacitor assets |
| `npm run mobile:add:android` | Add Android platform |
| `npm run mobile:add:ios` | Add iOS platform |
| `npm run mobile:open:android` | Open Android Studio project |

## 9. Backend Architecture

Core startup path:
- `app.js` initializes env, telemetry, optional reminder cron, and server lifecycle
- `apps/backend/server/create-app.js` wires middleware, APIs, static assets, and SPA fallback
- `apps/backend/server/create-server.js` wraps HTTP server + Socket.IO initialization

Key middleware:
- Request context and request ID
- API mode adaptation for JSON clients
- Auth session attachment
- Role authorization
- Structured error handling

## 10. API Surface (High Level)

Both prefixes are active:
- `/api/*`
- `/api/v1/*`

Health and session:
- `GET /health/live`
- `GET /health/ready`
- `GET /session`

Domain route groups:
- `/auth`
- `/users`
- `/doctors`
- `/patients`
- `/appointments`
- `/calls`
- `/prescriptions`
- `/documents`
- `/pharmacy`
- `/labs`
- `/reminders`
- `/support`
- `/ai`
- `/innovations`
- `/medicines`

OpenAPI baseline is maintained in `docs/openapi.yaml`.

## 11. Frontend Route Map

Public routes:
- `/`
- `/auth/login`
- `/auth/register`
- `/privacy-policy`
- `/terms-of-service`
- `/help-center`

Authenticated routes:
- `/dashboard`
- `/book`
- `/appointments`
- `/appointments/impact`
- `/appointments/:appointmentId`
- `/calls/:appointmentId`
- `/prescriptions/:appointmentId`
- `/doctors`
- `/doctors/:doctorId`
- `/doctors/me/slots` (doctor)
- `/doctors/me/analytics` (doctor)
- `/profile`
- `/users/me`
- `/patients/workspace` (patient)
- `/patients/me`
- `/medicines` (patient)
- `/pharmacy/orders`
- `/labs/tests`
- `/reminders`
- `/ai-copilot`
- `/doctor/patient-access` (doctor/admin)
- `/innovations`
- `/support/consents` (patient/help_worker)
- `/pdf-preview`

## 12. Major Functional Modules

### 12.1 Consultation and appointments
- Booking flow with doctor, slot, mode, and family context
- Appointment detail and lifecycle actions
- Presence and call readiness helpers
- No-show follow-up action flow

### 12.2 Prescriptions and medicine workflows
- Doctor prescription creation and update
- PDF generation and preview
- Handoff code support
- Patient medicine cabinet and medicine search

### 12.3 Labs and pharmacy
- Pharmacy order timeline and status updates
- Lab catalog, orders, status progression, and report attach
- PDF preview integration for reports and prescriptions

### 12.4 AI draft workflows
- Context endpoint and role-aware draft tools
- Draft note, reminder text, referral summary, async reply support
- Translation and helper guidance endpoints
- Review-required metadata policy for outputs

### 12.5 Innovation and care support
- Vitals and trends
- Care plans and check-ins
- Emergency escalation workflow
- External consult threads/messages
- Second-opinion request and audit trail
- Patient QR token sharing and doctor/admin access-by-token
- Consent and helper delegation controls

## 13. Data Model Summary

Primary models include:
- Identity and roles: `User`, `PatientProfile`, `DoctorProfile`
- Visits and consults: `Slot`, `Appointment`, `CallSession`, `DoctorReview`
- Clinical records: `Document`, `Prescription`, `ConsultationVital`, `Referral`
- Orders and tests: `PharmacyOrder`, `LabTestCatalog`, `LabOrder`, `LabOrderItem`
- Care coordination: `ReminderJob`, `CareSupportLink`, `ConsentAudit`, `PatientAccessToken`
- Extended innovation set: care plans, emergencies, external consult threads, voice notes, second opinions

Schema source of truth: `prisma/schema.prisma`

## 14. Security and Reliability

- Helmet CSP enabled
- Global rate limiting enabled
- Auth via secure cookie JWT
- Role-gated endpoints and ACL checks
- Structured request IDs in response headers
- Readiness and liveness probes for orchestration

## 15. Testing and Quality

Run tests:

```bash
npm test
```

Current automated coverage includes:
- Session endpoint behavior
- Versioned API parity checks (`/api` vs `/api/v1`)
- Health endpoints
- SPA fallback rendering
- Unauthorized access baseline checks

Extra QA reports and checklist outputs are available in `qa-reports/`.

## 16. Deployment and Operations Documentation

- API reference (route matrix): `docs/API.md`
- Azure deployment guide: `azure-deploy.md`
- Production readiness gates: `docs/production-readiness.md`
- Product requirements: `docs/PRD.md`
- UX and interaction design spec: `design.md`
- Capacitor wrapper workflow: `docs/CAPACITOR.md`

## 17. Mobile Wrapper Support

Capacitor configuration is included in `capacitor.config.ts`.

Use:

```bash
npm run mobile:sync
npm run mobile:add:android
npm run mobile:open:android
```

Current scope is wrapper readiness for the web app bundle (not native feature parity).

## 18. Troubleshooting

### 18.1 Frontend not loading on port 3000
- Run `npm run frontend:build`
- Restart server with `npm run dev`

### 18.2 Database readiness failing
- Ensure PostgreSQL is reachable from `DATABASE_URL`
- Run `npm run db:deploy` (or `npm run db:migrate` locally)

### 18.3 Missing Prisma client
- Run `npm run prisma:generate`

### 18.4 Socket or call connection issues in production
- Verify `APP_BASE_URL` is set to correct HTTPS origins
- Ensure WebSockets are enabled in host platform

### 18.5 AI endpoint fallback behavior
- If `OLLAMA_BASE_URL` is unset/unreachable, AI endpoints use fallback-safe behavior
- Check API response metadata for fallback indicators
