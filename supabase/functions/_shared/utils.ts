// Shared by every function in supabase/functions/ — folders prefixed with
// `_` aren't deployed as their own function, just imported by relative path.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// A browser calling an Edge Function enforces CORS (fires an OPTIONS
// preflight, and rejects the real response without this header) — curl/Node
// fetch don't, which is exactly why this was missing and untested until an
// actual browser call surfaced it. Every response, including errors, needs
// these headers, not just the preflight reply.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function handlePreflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  return null;
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// SUPABASE_SECRET_KEYS is a JSON object keyed by key name, e.g.
// {"default":"sb_secret_..."} — takes "default" if present, otherwise
// whatever the first value is. Falls back to the legacy var for older
// projects that don't have SUPABASE_SECRET_KEYS at all.
export function getServiceRoleKey(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed[0];
    if (parsed && typeof parsed === 'object') return parsed.default ?? Object.values(parsed)[0];
    return raw;
  } catch {
    return raw;
  }
}

// Resolves the caller's identity from their JWT — RLS still applies to
// anything this client does (it can't write daily_runs/profiles beyond
// what a normal user is allowed).
export function createUserClient(authHeader: string) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
}

// Bypasses RLS. Only ever use this after the caller has been authenticated
// (and, where relevant, authorized) via createUserClient() above — this
// client itself doesn't know or care who's asking.
export function createServiceClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, getServiceRoleKey());
}

export async function requireUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createUserClient(authHeader);
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return user;
}

// Role lives in profiles, not the JWT, so this is always a fresh
// server-side lookup — never trust a client-supplied "I'm admin" claim.
export async function isAdmin(db: ReturnType<typeof createServiceClient>, userId: string) {
  const { data } = await db.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'admin';
}
