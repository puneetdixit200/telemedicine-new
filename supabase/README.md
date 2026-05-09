# Supabase Setup

This folder contains the Supabase migration for the Next.js migration.

## Apply Schema

1. Create a Supabase project.
2. Copy `.env.local.example` to `.env.local` and fill in Supabase values.
3. Apply the migration:

```bash
supabase db push
```

If you are not using the Supabase CLI, paste `supabase/migrations/20260509000000_initial_telemedicine_schema.sql` into the Supabase SQL editor for a fresh project.

## Security Notes

- RLS is enabled on every application table created by the migration.
- The starter policies are conservative and favor patient/doctor/admin ownership checks.
- Do not use `raw_user_meta_data` for authorization. Store app roles in the app profile table or service-managed app metadata.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to client code.

## Compatibility Notes

The first migration keeps Prisma's current PascalCase table names so the existing backend logic can run against Supabase Postgres. Future route-by-route migrations can introduce simpler SQL views or lower-case tables after the app is stable on Next.js.

Supabase announced that new projects can opt out of exposing `public` tables to the Data API and that this becomes the default for new projects on May 30, 2026. This migration does not depend on public Data API exposure for server-side compatibility because Prisma and server-side clients use database credentials. If you later call these tables directly from the browser with the anon key, confirm the project Data API exposure settings and keep RLS enabled.
