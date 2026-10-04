import { BACKEND_URL, BACKEND_ANON_KEY, BACKEND_STORAGE_SUFFIX } from './backendOrigin';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = BACKEND_URL;
const SUPABASE_ANON_KEY = BACKEND_ANON_KEY;

export const SB_URL = SUPABASE_URL;
export const SB_KEY = SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: `lemtel-desktop-auth${BACKEND_STORAGE_SUFFIX}` },
});
