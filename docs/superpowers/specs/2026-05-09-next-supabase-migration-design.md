# Next.js Supabase Migration Design

## Goal

Move the telemedicine project into a Next.js App Router application while preserving the existing patient, doctor, helper, pharmacy, lab, AI, call, reminder, and document workflows. Supabase becomes the backend foundation for auth, Postgres data, RLS, and future realtime features. Azure Blob Storage remains the medical file storage provider.

## Decisions

- New repository name: `telemedicine-next-supabase`.
- Framework: Next.js App Router with React 19.
- Database: Supabase Postgres using the existing Prisma schema as the initial compatibility model.
- Auth target: Supabase Auth with application profile rows in `public.users`; keep compatibility helpers for the existing UI during the first migration pass.
- File upload target: Azure Blob Storage, using server-side upload/read-SAS route handlers only.
- Realtime target: preserve existing Socket.IO call behavior locally/custom-server first, then migrate signaling/chat to Supabase Realtime in a later focused pass.
- UI migration strategy: lift the current React Router SPA into a Next client component so feature coverage is preserved immediately.
- API migration strategy: expose a Next-owned compatibility API surface while adding Supabase server/browser clients and migration SQL. Existing business logic stays callable during the first pass, then can be moved route-by-route to server actions or route handlers.

## Architecture

The app uses `src/app` for the Next shell and renders the legacy React app from a client boundary. This minimizes UX churn and makes the migration buildable before deeper per-screen refactors. Global CSS and public assets are served by Next.

Backend code remains in `apps/backend` during the compatibility phase. The Prisma datasource points at Supabase Postgres via `DATABASE_URL`, while new Supabase helpers live under `src/lib/supabase`. Server-only helpers use the service role key only on the server. Browser helpers use only the publishable anon key.

Azure Blob helpers live under `src/lib/azure` and avoid module-scope client initialization so `next build` can run without real production secrets. Upload endpoints validate authentication server-side before writing patient documents.

## Data Model

The existing Prisma models are retained because they already cover the app domain. A Supabase SQL migration creates enums, tables, indexes, and RLS policies aligned with the compatibility model. The initial RLS posture is conservative:

- Patients can read and mutate their own patient-linked records.
- Doctors can read appointment-linked records where they are the assigned doctor.
- Admins can manage all application records.
- Help workers only receive access through care-support/consent relationships.
- Public anonymous access is denied by default except health/session metadata.

The user role is stored in app-owned profile rows, not editable Supabase `user_metadata`, so authorization does not depend on user-controlled JWT claims.

## Environment

The repo includes `.env.example`, `.env.local.example`, and docs listing required values:

- Supabase project URL, anon/publishable key, service role key, JWT secret, and Postgres connection string.
- Azure Storage account connection string, container name, and optional public base URL.
- Optional Application Insights and Ollama-compatible AI endpoint.

No real secrets are committed.

## Verification

The migration is considered usable when:

- `npm test` passes.
- `npm run build` builds the Next app.
- `/` and deep app routes render through Next.
- `/api/session` and `/api/health/live` are available.
- Env validation explains missing Supabase/Azure values clearly.

## Known Follow-Up

The full backend should later be split into smaller Next-native modules: auth/profile, appointments, documents, labs/pharmacy, AI, and realtime calls. This first migration intentionally prioritizes buildability and feature continuity.
