import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Guest play (see DECISIONS.md) never touches this — it's only used once
// real accounts are wired up in AuthContext. Stays null until the env vars
// are set, so the app doesn't crash before a Supabase project exists yet.
export const supabase = isSupabaseConfigured ? createClient(url, anonKey) : null;
