# Environment Setup

Use `.env.local.example` as the local template and keep real secrets out of git.

## Required for Supabase

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL from Project Settings.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser-safe anon or publishable key from Project API settings.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key for privileged route handlers and migrations. Never expose it to the browser.
- `DATABASE_URL`: Supabase Postgres connection string for Prisma and compatibility API code.
- `DIRECT_URL`: optional direct database URL for migrations and local admin tasks.

## Required for Azure Blob Storage

- `AZURE_STORAGE_CONNECTION_STRING`: storage account connection string.
- `AZURE_STORAGE_CONTAINER`: container for patient documents, usually `patient-documents`.
- `AZURE_STORAGE_PUBLIC_BASE_URL`: optional CDN/public base URL. Secure reads use SAS URLs by default.
- `AZURE_UPLOADS_MODE`: use `azure-only` for production.

## Required for App Auth Compatibility

- `JWT_SECRET`: long random secret used by the compatibility API while auth migrates fully to Supabase Auth.
- `JWT_EXPIRES_IN`: token lifetime, default `1d`.
- `NEXT_PUBLIC_SITE_URL`: public app URL used for redirects.

## Optional

- `APPLICATIONINSIGHTS_CONNECTION_STRING`: Azure Application Insights telemetry.
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`: AI copilot endpoint settings.
- `ADMIN_INVITE_CODE`: restricts admin registration.
- `ENABLE_REMINDER_CRON`, `REMINDER_CRON_INTERVAL_MS`, `REMINDER_CRON_BATCH_LIMIT`: reminder dispatch settings.
