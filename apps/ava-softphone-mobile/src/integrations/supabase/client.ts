import { BACKEND_URL, BACKEND_ANON_KEY, BACKEND_STORAGE_SUFFIX } from '../../lib/backendOrigin';
import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const SUPABASE_URL = BACKEND_URL;
const SUPABASE_ANON_KEY = BACKEND_ANON_KEY;

// On native iOS/Android, localStorage is unreliable across app restarts.
// Use Capacitor Preferences (backed by NSUserDefaults / SharedPreferences)
// so the Supabase session is persisted and refreshed correctly.
const nativeStorage = Capacitor.isNativePlatform()
  ? {
      getItem: async (key: string) => {
        try {
          const { value } = await Preferences.get({ key });
          return value ?? null;
        } catch {
          return null;
        }
      },
      setItem: async (key: string, value: string) => {
        try {
          await Preferences.set({ key, value });
        } catch {}
      },
      removeItem: async (key: string) => {
        try {
          await Preferences.remove({ key });
        } catch {}
      },
    }
  : undefined;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: nativeStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    ...(BACKEND_STORAGE_SUFFIX ? { storageKey: `lemtel-mobile-alt-auth${BACKEND_STORAGE_SUFFIX}` } : {}),
  },
});
