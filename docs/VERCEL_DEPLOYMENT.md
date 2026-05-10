# Vercel Deployment

Primary deployment path: import `https://github.com/puneetdixit200/telemedicine-new.git` into Vercel and keep the production branch as `main`.

## Build Settings

- Framework preset: Next.js
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: leave default
- Root directory: repository root

Vercel will create preview deployments for non-production branches and a production deployment whenever `main` is pushed.

`vercel.json` sets the function region to `sin1`, close to the Supabase `ap-southeast-1` database. Keep this unless the database region changes.

## Environment Variables

Configure these in Vercel Project Settings for Production and Preview:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_ACCOUNT_NAME` and `AZURE_STORAGE_ACCOUNT_KEY` if you do not use a full connection string
- `AZURE_STORAGE_CONTAINER`
- `AZURE_STORAGE_PUBLIC_BASE_URL`
- `AZURE_UPLOADS_MODE=azure-only`
- `APP_BASE_URL`
- `READINESS_TIMEOUT_MS=5000`
- `PRISMA_CONNECTION_LIMIT=1`
- `SUPABASE_AUTH_CACHE_TTL_MS=30000`
- `APP_USER_CACHE_TTL_MS=15000`
- `DOCTOR_TRUST_CACHE_TTL_MS=60000`
- `ADMIN_INVITE_CODE` if admin self-registration should stay restricted
- Optional AI vars: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_TIMEOUT_MS`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`

`JWT_SECRET` is no longer required for normal login/session handling. Keep it only if you run legacy compatibility paths that still mint temporary local tokens.

## Post-Import Checks

1. Run `npm run db:deploy` locally or from CI against the Supabase database.
2. Run `npm run db:seed` twice to confirm the demo data and Supabase Auth accounts are idempotent.
3. Confirm these production URLs work after the Vercel deployment:
   - `/`
   - `/auth/login`
   - `/dashboard`
   - `/api/session`
   - `/api/health/ready`
4. Confirm document uploads run with `AZURE_UPLOADS_MODE=azure-only`.
5. Confirm a patient and doctor can join the same consultation room; ending from either side should redirect the other side back to the appointment.
