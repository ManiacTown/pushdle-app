import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import * as storage from './storage.js';
import { hasSeenOnboardingLocally } from './onboarding.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [role, setRole] = useState(null); // 'player' | 'admin' | null (logged out / unknown)
  const [selectedEmoji, setSelectedEmojiState] = useState(null);
  // Lifetime stats (best streak, total pushes, day streak, bust flags) —
  // null while logged out, or while the login-time merge below is still in
  // flight. See Home.jsx/Profile.jsx, which read this instead of
  // storage.js whenever a user is logged in.
  const [stats, setStats] = useState(null);
  // Whether THIS account has dismissed the first-visit onboarding modal on
  // any device — null while logged out or still loading (see
  // OnboardingModal.jsx, which treats null as "don't know yet, don't
  // render"). Guests never touch this; they check localStorage directly.
  const [onboardingSeen, setOnboardingSeenState] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUser(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Role and flair live in profiles, not the auth session itself, so
  // they're a separate fetch once we know who's logged in.
  useEffect(() => {
    if (!user) {
      setRole(null);
      setSelectedEmojiState(null);
      setStats(null);
      setOnboardingSeenState(null);
      return;
    }
    supabase
      .from('profiles')
      .select('role, selected_emoji')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setRole(data?.role ?? 'player');
        setSelectedEmojiState(data?.selected_emoji ?? null);
      });

    // Deliberately a separate query from role/selected_emoji above, not
    // folded into the same .select() — Postgrest rejects a select() as a
    // whole if ANY requested column doesn't exist yet, so bundling this in
    // would mean a not-yet-migrated database (missing onboarding_seen)
    // breaks role/flair loading too (silently defaulting every logged-in
    // user to 'player' with no flair) instead of just this one feature
    // quietly no-op'ing until the column exists.
    supabase
      .from('profiles')
      .select('onboarding_seen')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          setOnboardingSeenState(hasSeenOnboardingLocally());
          return;
        }
        const serverSeen = data?.onboarding_seen ?? false;
        // A guest who dismissed the modal locally, then signed up — or an
        // existing account logging in on a device that already dismissed
        // it pre-login — should never see it again either. Only ever
        // pushes true, and only when the server doesn't already have it,
        // same "OR, never lowers" philosophy as merge_local_stats below.
        if (hasSeenOnboardingLocally() && !serverSeen) {
          setOnboardingSeenState(true); // optimistic — no need to wait on the round trip
          supabase
            .from('profiles')
            .update({ onboarding_seen: true })
            .eq('id', user.id)
            .then(({ error }) => {
              if (error) console.error('onboarding_seen carry-over failed:', error);
            });
        } else {
          setOnboardingSeenState(serverSeen);
        }
      });

    // Money-variant wallet/lifetime totals (admin-gated feature — see
    // MoneyMode.jsx). Same reasoning as the onboarding_seen query above:
    // kept separate from role/selected_emoji so a not-yet-migrated
    // database (missing these columns) can't take that query down too —
    // this one just silently no-ops, leaving the fields undefined, until
    // the migration's run. Merged into `stats` via a functional update
    // (not a plain overwrite) since this resolves independently of the
    // sync-stats call below and either could land first.
    supabase
      .from('profiles')
      .select('money_wallet_cents, money_lifetime_cents')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) return;
        setStats((prev) => ({
          ...prev,
          moneyWalletCents: data?.money_wallet_cents ?? 0,
          moneyLifetimeCents: data?.money_lifetime_cents ?? 0,
        }));
      });

    // Merges any locally-tracked progress (from before stats were
    // server-authoritative, or from guest play on this device pre-login)
    // into the server row — see schema.sql's merge_local_stats. Safe to run
    // on every login: it only ever raises values, never lowers them.
    (async () => {
      const [localBest, localStats] = await Promise.all([storage.getBestStreak(), storage.getStats()]);
      try {
        const { data, error } = await supabase.functions.invoke('sync-stats', {
          body: { bestStreak: localBest, ...localStats },
        });
        if (error) throw error;
        setStats(data);
      } catch (err) {
        console.error('stats sync failed, falling back to local values:', err);
        setStats({ bestStreak: localBest, ...localStats });
      }
    })();
  }, [user]);

  // Returns the raw Supabase signUp() result so the caller can tell whether
  // a session came back immediately or email confirmation is required —
  // see Login.jsx.
  async function signUp(email, password, username) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  // Emails a recovery link pointing back at /reset-password; Supabase
  // appends a recovery token to that URL, which supabase-js auto-exchanges
  // for a session on load (see ResetPassword.jsx).
  async function sendPasswordReset(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  }

  // Only valid while the recovery session from the emailed link is active.
  async function updatePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  // `emoji` is null to clear it. The column-restricted grant + check
  // constraint in supabase/schema.sql do the actual enforcement — this is
  // just the client's side of that (see Profile.jsx for the badge-earned
  // gating, which is client-side only, see the schema's comment on why).
  async function updateSelectedEmoji(emoji) {
    const { error } = await supabase.from('profiles').update({ selected_emoji: emoji }).eq('id', user.id);
    if (error) throw error;
    setSelectedEmojiState(emoji);
  }

  // Called by OnboardingModal.jsx when a logged-in player dismisses it —
  // only ever sets true, mirroring the column's own one-way semantics.
  async function markOnboardingSeen() {
    if (!user) return;
    setOnboardingSeenState(true); // optimistic, same reasoning as the carry-over above
    const { error } = await supabase.from('profiles').update({ onboarding_seen: true }).eq('id', user.id);
    if (error) console.error('failed to sync onboarding_seen:', error);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isAdmin: role === 'admin',
        selectedEmoji,
        stats,
        // Lets Home.jsx push a fresh stats snapshot (e.g. straight from a
        // push/admin Edge Function response) into context, so Profile — or
        // Home on a later remount — sees it immediately rather than the
        // stale login-time merge snapshot.
        setStats,
        // null = logged out, or logged in but not loaded yet — see
        // OnboardingModal.jsx, which treats null as "don't render yet".
        onboardingSeen,
        markOnboardingSeen,
        signUp,
        signIn,
        logout,
        sendPasswordReset,
        updatePassword,
        updateSelectedEmoji,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
