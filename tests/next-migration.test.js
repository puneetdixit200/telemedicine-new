const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Next.js Supabase migration guard', () => {
  it('uses Next.js as the primary app runtime while preserving legacy scripts', () => {
    const pkg = readJson('package.json');

    expect(pkg.scripts.dev).toContain('next dev');
    expect(pkg.scripts.build).toBe('next build');
    expect(pkg.scripts.start).toContain('server-next.js');
    expect(pkg.scripts['dev:custom']).toContain('server-next.js');
    expect(pkg.scripts['legacy:dev']).toBe('nodemon app.js');
    expect(pkg.dependencies).toHaveProperty('next');
    expect(pkg.dependencies).toHaveProperty('@supabase/supabase-js');
    expect(pkg.dependencies).toHaveProperty('@supabase/ssr');
  });

  it('has a Next App Router shell that mounts the existing app through a client boundary', () => {
    const layout = readText('src/app/layout.jsx');
    const catchAllPage = readText('src/app/[[...slug]]/page.jsx');
    const legacyBoundary = readText('src/components/LegacyTelemedicineApp.jsx');
    const legacyRuntime = readText('src/components/LegacyTelemedicineRuntime.jsx');

    expect(layout).toContain('Telemedicine Rural Care');
    expect(catchAllPage).toContain('LegacyTelemedicineApp');
    expect(legacyBoundary).toContain("'use client'");
    expect(legacyBoundary).toContain('ssr: false');
    expect(legacyRuntime).toContain('BrowserRouter');
    expect(legacyRuntime).toContain('v7_startTransition');
    expect(legacyRuntime).toContain("apps/frontend/src/App");
  });

  it('documents the required Supabase and Azure environment variables', () => {
    const envExample = readText('.env.example');
    const envLocalExample = readText('.env.local.example');
    const envDocs = readText('docs/ENVIRONMENT.md');

    for (const variableName of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
      'AZURE_STORAGE_CONNECTION_STRING',
      'AZURE_STORAGE_CONTAINER'
    ]) {
      expect(envExample).toContain(variableName);
      expect(envLocalExample).toContain(variableName);
      expect(envDocs).toContain(variableName);
    }
  });

  it('adds lazy server helpers for Supabase and Azure Blob uploads', () => {
    const env = readText('src/lib/env.js');
    const serverClient = readText('src/lib/supabase/server.js');
    const adminClient = readText('src/lib/supabase/admin.js');
    const azureStorage = readText('src/lib/azure/blob-storage.js');
    const uploadRoute = readText('src/app/api/uploads/documents/route.js');

    expect(env).toContain('getRequiredServerEnv');
    expect(serverClient).toContain('createServerClient');
    expect(adminClient).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(azureStorage).toContain('BlobServiceClient');
    expect(uploadRoute).toContain('formData');
  });

  it('includes Supabase migration and compatibility API documentation', () => {
    const migration = readText('supabase/migrations/20260509000000_initial_telemedicine_schema.sql');
    const supabaseReadme = readText('supabase/README.md');
    const repoSetup = readText('docs/GITHUB_REPO_SETUP.md');
    const apiFallback = readText('src/pages/api/[[...path]].js');

    expect(migration).toContain('enable row level security');
    expect(migration).toContain('telemedicine_current_user_id');
    expect(supabaseReadme).toContain('Supabase');
    expect(repoSetup).toContain('telemedicine-new');
    expect(apiFallback).toContain('createApp');
  });

  it('uses Supabase Auth, Prisma config seed, Vercel CI, and Playwright E2E wiring', () => {
    const pkg = readJson('package.json');
    const schema = readText('prisma/schema.prisma');
    const authController = readText('apps/backend/controllers/auth.controller.js');
    const authMiddleware = readText('apps/backend/middleware/auth.js');
    const prismaConfig = readText('prisma.config.ts');
    const ci = readText('.github/workflows/ci.yml');
    const playwrightConfig = readText('playwright.config.js');

    expect(pkg).not.toHaveProperty('prisma');
    expect(pkg.scripts).toHaveProperty('test:e2e');
    expect(schema).toMatch(/passwordHash\s+String\?/);
    expect(schema).toMatch(/supabaseAuthUserId\s+String\?\s+@unique/);
    expect(authController).toContain('signInWithPassword');
    expect(authController).toContain('createOrUpdateAuthUser');
    expect(authMiddleware).toContain('getAuthenticatedSupabaseUser');
    expect(prismaConfig).toContain("seed: 'node prisma/seed.js'");
    expect(ci).toContain('npm run build');
    expect(ci).toContain('npm run test:e2e');
    expect(playwrightConfig).toContain('@playwright/test');
  });
});
