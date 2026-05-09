'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getPublicSupabaseEnv } from '@/lib/env';

let browserClient;

export function createSupabaseBrowserClient() {
  if (!browserClient) {
    const { url, anonKey } = getPublicSupabaseEnv();
    browserClient = createBrowserClient(url, anonKey);
  }

  return browserClient;
}
