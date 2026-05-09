import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getRequiredServerEnv } from '@/lib/env';

let adminClient;

export function getSupabaseAdminClient() {
  if (!adminClient) {
    const url = getRequiredServerEnv('NEXT_PUBLIC_SUPABASE_URL');
    const serviceRoleKey = getRequiredServerEnv('SUPABASE_SERVICE_ROLE_KEY');
    adminClient = createClient(url, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return adminClient;
}
