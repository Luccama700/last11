/**
 * Supabase client factory. Multiplayer uses ONLY Realtime broadcast + presence —
 * no tables, no auth, no storage — so the publishable (anon) key is all it needs.
 * Vite inlines VITE_* env vars at build time; without them the app runs solo-only
 * and the online door explains itself instead of crashing.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

export function supa(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  client =
    url && key
      ? createClient(url, key, {
          realtime: { params: { eventsPerSecond: 20 } },
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return client;
}

export const onlineConfigured = (): boolean => supa() !== null;
