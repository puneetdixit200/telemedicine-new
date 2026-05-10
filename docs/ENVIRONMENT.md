# Environment Setup

Use `.env.local.example` as the local template and keep real secrets out of git.

## Required for Supabase

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL from Project Settings.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: browser-safe anon or publishable key from Project API settings.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key for Supabase Auth admin operations, privileged route handlers, and migrations. Never expose it to the browser.
- `DATABASE_URL`: Supabase Postgres connection string for Prisma and compatibility API code.
- `DIRECT_URL`: optional direct database URL for migrations and local admin tasks.
- `APP_BASE_URL`: public app URL, for example `https://telemedicine-new.vercel.app`.

## Required for Azure Blob Storage

- `AZURE_STORAGE_CONNECTION_STRING`: storage account connection string.
- `AZURE_STORAGE_ACCOUNT_NAME` and `AZURE_STORAGE_ACCOUNT_KEY`: optional alternative to a full connection string. Use real values; placeholders are ignored.
- `AZURE_STORAGE_CONTAINER`: container for patient documents, usually `patient-documents`.
- `AZURE_STORAGE_PUBLIC_BASE_URL`: optional CDN/public base URL. Secure reads use SAS URLs by default.
- `AZURE_UPLOADS_MODE`: use `azure-only` for production.

## Temporary Legacy Compatibility

- `JWT_SECRET`: only needed for legacy local call-server compatibility code. Normal login, registration, logout, and `/api/session` now use Supabase Auth cookies.
- `JWT_EXPIRES_IN`: legacy token lifetime, default `1d`.
- `NEXT_PUBLIC_SITE_URL`: optional public app URL used for provider redirects.

## Required in Vercel

Set these for Production and Preview in the Vercel project:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_ACCOUNT_NAME` and `AZURE_STORAGE_ACCOUNT_KEY` if no connection string is provided
- `AZURE_STORAGE_CONTAINER`
- `AZURE_STORAGE_PUBLIC_BASE_URL`
- `AZURE_UPLOADS_MODE=azure-only`
- `APP_BASE_URL`
- `READINESS_TIMEOUT_MS`
- Optional AI vars: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_TIMEOUT_MS`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`.

## Optional

- `APPLICATIONINSIGHTS_CONNECTION_STRING`: Azure Application Insights telemetry.
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_TIMEOUT_MS`: online AI copilot settings. OpenRouter is preferred when configured.
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS`, `AI_RATE_LIMIT_PER_MINUTE`: local Ollama fallback and AI endpoint rate-limit settings.
- `ADMIN_INVITE_CODE`: restricts admin registration.
- `ENABLE_REMINDER_CRON`, `REMINDER_CRON_INTERVAL_MS`, `REMINDER_CRON_BATCH_LIMIT`: reminder dispatch settings.

## Runtime Notes

- User-facing dates and times are formatted in Indian Standard Time (`Asia/Kolkata`).
- Azure-only document uploads require valid Azure credentials. For local testing without Azure, set `AZURE_UPLOADS_MODE=local-only`.
- OpenRouter is used before Ollama when `OPENROUTER_API_KEY` is set. The default free model is `openai/gpt-oss-120b:free`.
