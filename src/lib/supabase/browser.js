'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getPublicSupabaseEnv } from '@/lib/env';

let browserClient;
let browserClientConfigKey;

export function createSupabaseBrowserClient(config) {
  const { url, anonKey } = config || getPublicSupabaseEnv();
  const configKey = `${url}:${anonKey}`;
  if (!browserClient || browserClientConfigKey !== configKey) {
    browserClient = createBrowserClient(url, anonKey);
    browserClientConfigKey = configKey;
  }

  return browserClient;
}
