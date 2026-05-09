# Next.js Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the telemedicine app into a Next.js App Router project with Supabase backend wiring and Azure Blob upload support.

**Architecture:** Next.js owns routing and rendering. The existing React app is mounted as a client component for immediate feature continuity. Supabase helpers, env validation, and SQL/RLS migrations are added so the backend can run against Supabase Postgres and move away from Express route-by-route.

**Tech Stack:** Next.js, React, Supabase JS/SSR, Prisma, Azure Storage Blob, Jest, React Router compatibility layer.

---

### Task 1: Add Migration Guard Tests

**Files:**
- Modify: `tests/app.test.js`
- Create: `tests/next-migration.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that assert the repo now exposes Next scripts, Supabase env placeholders, and server-safe helper files.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand tests/next-migration.test.js`
Expected: FAIL because the Next migration files do not exist yet.

- [ ] **Step 3: Implement minimal migration files**

Add Next config, app shell, Supabase helpers, Azure helpers, env templates, and compatibility pages.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --runInBand tests/next-migration.test.js`
Expected: PASS.

### Task 2: Convert Package to Next Build

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `next.config.js`
- Create: `jsconfig.json`

- [ ] **Step 1: Update dependencies and scripts**

Install Next, React 19, Supabase client packages, and any Next-compatible build dependencies.

- [ ] **Step 2: Preserve legacy commands**

Keep `legacy:*` scripts for old Express/Vite entry points while making `dev`, `build`, and `start` run Next.

- [ ] **Step 3: Run install**

Run: `npm install`
Expected: lockfile updates successfully.

### Task 3: Add Next App Shell

**Files:**
- Create: `src/app/layout.jsx`
- Create: `src/app/[[...slug]]/page.jsx`
- Create: `src/app/globals.css`
- Create: `src/components/LegacyTelemedicineApp.jsx`

- [ ] **Step 1: Add client boundary**

Wrap the existing React app in a `BrowserRouter` inside a client component.

- [ ] **Step 2: Add catch-all route**

Render the legacy app for `/`, `/dashboard`, `/appointments/:id`, and other SPA routes.

- [ ] **Step 3: Add global CSS import**

Import the existing stylesheet through Next globals.

### Task 4: Add Supabase Backend Wiring

**Files:**
- Create: `src/lib/supabase/browser.js`
- Create: `src/lib/supabase/server.js`
- Create: `src/lib/supabase/admin.js`
- Create: `src/lib/env.js`
- Create: `supabase/migrations/20260509000000_initial_telemedicine_schema.sql`
- Create: `supabase/README.md`

- [ ] **Step 1: Add lazy Supabase clients**

Create browser, server-cookie, and admin clients without module-scope secret-dependent initialization.

- [ ] **Step 2: Add env validation**

Centralize required env names and return clear missing-variable messages.

- [ ] **Step 3: Add SQL migration**

Port Prisma schema to Supabase SQL with RLS enabled and conservative starter policies.

### Task 5: Add Azure Upload Wiring

**Files:**
- Create: `src/lib/azure/blob-storage.js`
- Create: `src/app/api/uploads/documents/route.js`

- [ ] **Step 1: Add lazy Azure client**

Use `BlobServiceClient.fromConnectionString` inside getter functions only.

- [ ] **Step 2: Add upload route**

Accept multipart uploads, write to Azure Blob, and return blob metadata.

### Task 6: Preserve API Compatibility

**Files:**
- Create: `src/pages/api/[[...path]].js`
- Modify: `apps/backend/server/create-app.js`

- [ ] **Step 1: Add Pages API fallback**

Forward `/api/*` requests into the existing Express app while route-by-route Next migration continues.

- [ ] **Step 2: Keep backend static serving out of Next API**

Ensure Next owns frontend rendering and Express handles only API compatibility.

### Task 7: Document Secrets and Repo Publishing

**Files:**
- Modify: `.env.example`
- Create: `.env.local.example`
- Create: `docs/ENVIRONMENT.md`
- Create: `docs/GITHUB_REPO_SETUP.md`

- [ ] **Step 1: Document required values**

List Supabase, Azure, AI, and telemetry variables with where to find each one.

- [ ] **Step 2: Document GitHub repo creation**

Explain that this environment lacks `gh` and no GitHub connector repo-create tool is available, so the code is ready for pushing once the repo exists.

### Task 8: Verify

**Files:**
- All changed files

- [ ] **Step 1: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Start dev server**

Run: `npm run dev`
Expected: Next starts and serves `/`.
