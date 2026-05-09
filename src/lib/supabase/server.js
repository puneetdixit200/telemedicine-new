import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getPublicSupabaseEnv } from '@/lib/env';

export async function createSupabaseServerClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch (_error) {
          // Server Components cannot write cookies. Proxy/route handlers can.
        }
      }
    }
  });
}
