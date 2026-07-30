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

// Money mode's progression gate: an account can't play it until it's
// played classic at least once (see Home.jsx's own client-side copy of
// this same rule, on the mode-switch button). total_pushes is bumped only
// by resolve_push (classic) — never by resolve_money_push — so it's a
// reliable, already-tracked "has this account ever finished a classic
// push" signal with no new column needed. Checked here (money-push) too,
// not just client-side, same reasoning as isAdmin above: the button being
// disabled doesn't stop a direct call to the function.
export async function hasPlayedClassic(db: ReturnType<typeof createServiceClient>, userId: string) {
  const { data } = await db.from('profiles').select('total_pushes').eq('id', userId).single();
  return (data?.total_pushes ?? 0) > 0;
}

// The daily reset boundary is midnight in the Los Angeles timezone, not
// UTC — see src/lib/pacificDate.js (client-side twin of this function;
// Deno can't import that file directly, so it's mirrored here — keep both
// in sync). Every daily_runs.date write/read across the app must go
// through one of these two so "today" always means the same calendar day
// everywhere, regardless of which runtime is asking.
const TIME_ZONE = 'America/Los_Angeles';

export function pacificDateString(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Mirrors every `field` src/lib/game.js's BADGES array reads (see
// maxStatsForAllBadges/zeroStatsForAllBadges there), converted to
// snake_case — same "Deno can't import that file directly" limitation as
// pacificDateString above, so this is the Deno-side twin. Add the new
// column here whenever a badge is added with a `field` not already listed.
//
// Used as an ALLOWLIST (see admin/index.ts's reset_badges/claim_all_badges
// handler): those tools may only ever write a column a real badge
// threshold actually reads, no matter what the client sends. An allowlist
// fails SAFE if this list goes stale (a new badge's fields just can't be
// claimed/reset until added here — loud and easy to notice) — the denylist
// this replaced failed OPEN instead (silently permitted writes to any
// column not explicitly named, which is how it ended up missing several
// money_* columns and best_streak/total_pushes entirely).
export const ALLOWED_BADGE_FIELDS = new Set([
  'best_streak',
  'total_pushes',
  'day_streak',
  'busted_at_zero',
  'busted_at_one',
  'money_best_bank_streak',
  'money_lifetime_cents',
  'money_best_run_cents',
  'money_banked_after_one_push',
  'money_reached_top3_weekly',
  'money_busted_over100',
]);
