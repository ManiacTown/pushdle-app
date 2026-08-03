import { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import * as storage from './storage.js';
import { hasSeenOnboardingLocally } from './onboarding.js';
import { hasSeenMoneyUnlockLocally } from './moneyUnlock.js';

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
  // Whether THIS account has seen MoneyModeUnlockModal.jsx's unlock
  // announcement — same null-while-unknown convention as onboardingSeen
  // above, but no localStorage side (see the modal's own comment on why).
  const [moneyUnlockSeen, setMoneyUnlockSeenState] = useState(null);
  // Whether THIS account has seen PityIntroModal.jsx's Comeback Boost
  // explainer — same null-while-unknown/no-localStorage-side reasoning as
  // moneyUnlockSeen above (registered-accounts-only feature).
  const [pityIntroSeen, setPityIntroSeenState] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setUser(null);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Fires on every auth event, including TOKEN_REFRESHED — which
      // happens automatically roughly hourly while a tab stays open, for
      // the SAME logged-in account. A plain setUser(session?.user) here
      // would hand back a brand-new object every time regardless, and
      // several effects elsewhere (Home.jsx's loadRunState, MoneyMode.jsx's
      // run-loading effect) are deliberately keyed off `[user]` by
      // reference — a token refresh landing mid-reveal could re-fire them
      // and jump straight to the "already resolved" instant-restore path
      // over a still-animating bust/cash-out. Keeping the SAME object
      // reference when it's genuinely the same account (compared by id,
      // not identity) means those effects only ever re-run on a real
      // login/logout/account switch, which is what they actually want.
      setUser((prev) => {
        const next = session?.user ?? null;
        if (prev && next && prev.id === next.id) return prev;
        return next;
      });
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
      setMoneyUnlockSeenState(null);
      setPityIntroSeenState(null);
      return;
    }
    supabase
      .from('profiles')
      .select('role, selected_emoji')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        // Falls back to 'player'/no-flair either way (the correct
        // fail-safe default — never silently grant admin), but this used
        // to swallow a real fetch failure with no trace at all. Logged,
        // not surfaced as UI here — there's no good place in a context
        // provider to show an error banner, and every consumer already
        // treats null/'player' as a normal, valid state.
        if (error) console.error('role/flair fetch failed:', error);
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

    // Same defensive separate-query reasoning as onboarding_seen just
    // above (a not-yet-migrated database missing this column can't take
    // role/flair or onboarding_seen loading down with it). Also carries
    // over a guest-local dismissal on signup, same "OR, never lowers"
    // reasoning as onboarding_seen right above — without this, a guest
    // who already saw the unlock modal before creating an account would
    // see it a second time as a "welcome back" the moment they sign up
    // (money_unlock_seen defaults false on a brand-new profile row,
    // and this trigger doesn't know about the local dismissal otherwise).
    supabase
      .from('profiles')
      .select('money_unlock_seen')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          // Defaults to false (not yet seen) rather than true, unlike
          // onboarding_seen's error fallback — showing it an extra time is
          // harmless but silently never showing it at all isn't.
          setMoneyUnlockSeenState(false);
          return;
        }
        const serverSeen = data?.money_unlock_seen ?? false;
        if (hasSeenMoneyUnlockLocally() && !serverSeen) {
          setMoneyUnlockSeenState(true);
          supabase
            .from('profiles')
            .update({ money_unlock_seen: true })
            .eq('id', user.id)
            .then(({ error }) => {
              if (error) console.error('money_unlock_seen carry-over failed:', error);
            });
        } else {
          setMoneyUnlockSeenState(serverSeen);
        }
      });

    // Same defensive separate-query reasoning as onboarding_seen/
    // money_unlock_seen above (a not-yet-migrated database missing this
    // column can't take role/flair or the others down with it). No
    // localStorage/guest carry-over needed at all here, unlike either of
    // those — Comeback Boost is registered-accounts-only from the start
    // (see profiles.pity_count), so there's no pre-login local dismissal
    // that could ever exist to carry over.
    supabase
      .from('profiles')
      .select('pity_intro_seen')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        // Defaults to false (not yet seen) on error, same reasoning as
        // money_unlock_seen's own fallback — showing it an extra time is
        // harmless, silently never showing it at all isn't.
        setPityIntroSeenState(error ? false : data?.pity_intro_seen ?? false);
      });

    // Money-variant wallet/lifetime totals (see MoneyMode.jsx). Same
    // reasoning as the onboarding_seen query above:
    // kept separate from role/selected_emoji so a not-yet-migrated
    // database (missing these columns) can't take that query down too —
    // this one just silently no-ops, leaving the fields undefined, until
    // the migration's run. See refreshMoneyStats below — this is just its
    // login-time call. Home.jsx's loadStats effect waits on
    // moneyLifetimeCents specifically (alongside bestStreak) as its signal
    // that BOTH login-time queries have landed before taking its one-time
    // stats/earnedAtRunStart/pity-meter snapshot — refreshMoneyStats
    // itself silently no-ops on error (returns null, touches no state),
    // so a single transient failure here would otherwise leave that
    // marker undefined forever, permanently blocking that snapshot for
    // the rest of the session (nothing else re-calls this for a player
    // who never opens Money Mode). Falling back to a safe 0 on failure is
    // what keeps that from being a silent, permanent dead end — a later
    // real visit to Money Mode still refreshes it properly regardless.
    refreshMoneyStats().then((result) => {
      if (!result) setStats((prev) => ({ ...prev, moneyLifetimeCents: prev?.moneyLifetimeCents ?? 0 }));
    });

    // Merges any locally-tracked progress (from before stats were
    // server-authoritative, or from guest play on this device pre-login)
    // into the server row — see schema.sql's merge_local_stats. Safe to run
    // on every login: it only ever raises values, never lowers them.
    (async () => {
      const [localBest, localStats, todayState] = await Promise.all([
        storage.getBestStreak(),
        storage.getStats(),
        storage.getTodayState(),
      ]);
      // Only worth sending if there's a genuinely meaningful local run to
      // carry over — playing (still in progress) or dead (already busted,
      // so this guest-then-signup still shows up on today's leaderboard
      // for that run) both count; an empty/never-played run has nothing
      // daily_runs needs to know about (see merge_local_stats, which only
      // ever acts on this when it's actually present and > 0 anyway;
      // skipping it here too just avoids sending a pointless field on
      // every login).
      const todayRunToCarryOver =
        (todayState.status === 'playing' || todayState.status === 'dead') && todayState.streak > 0
          ? { todayDate: todayState.date, todayStreak: todayState.streak, todayStatus: todayState.status }
          : {};
      try {
        const { data, error } = await supabase.functions.invoke('sync-stats', {
          body: { bestStreak: localBest, ...localStats, ...todayRunToCarryOver },
        });
        if (error) throw error;
        // Merged, not replaced — this resolves independently of (and in no
        // guaranteed order relative to) the money-stats fetch above, so a
        // plain setStats(data) here could wipe out moneyWalletCents/
        // moneyLifetimeCents if this happens to land second.
        setStats((prev) => ({ ...prev, ...data }));
      } catch (err) {
        console.error('stats sync failed, falling back to local values:', err);
        setStats((prev) => ({ ...prev, bestStreak: localBest, ...localStats }));
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

  // Re-fetches every money-badge-relevant profile field and merges the
  // result into `stats` (functional update, not a replace — this can race
  // the sync-stats merge below, same reasoning as that call's own
  // comment). Called once at login (see the [user] effect above) AND
  // exposed here so MoneyMode.jsx can call it on demand right after a
  // push/cash-out resolves — those RPCs write these columns server-side,
  // but MoneyMode only ever pushes moneyWalletCents/moneyLifetimeCents
  // into stats itself (see launchCoinToWallet), so without this the rest
  // of the money badge fields would silently go stale until a reload.
  // Returns the fetched camelCase slice (or null on error/logged-out) so a
  // caller can diff against it immediately, without waiting on a re-render
  // to see the new stats.
  async function refreshMoneyStats() {
    if (!user) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'money_wallet_cents, money_lifetime_cents, money_best_run_cents, money_best_bank_streak, ' +
          'money_weekly_cents, money_best_weekly_cents, money_diamonds, owns_diamond_button, ' +
          'owned_cosmetics, active_push_skin, active_aura, active_row_style, owns_insurance, insurance_used_this_week, ' +
          'money_reached_top3_weekly, money_banked_after_one_push, money_busted_over100'
      )
      .eq('id', user.id)
      .single();
    if (error) return null;
    const next = {
      moneyWalletCents: data?.money_wallet_cents ?? 0,
      moneyLifetimeCents: data?.money_lifetime_cents ?? 0,
      // Money-badge fields (see game.js's money-* BADGES).
      moneyBestRunCents: data?.money_best_run_cents ?? 0,
      moneyBestBankStreak: data?.money_best_bank_streak ?? 0,
      moneyReachedTop3Weekly: !!data?.money_reached_top3_weekly,
      moneyBankedAfterOnePush: !!data?.money_banked_after_one_push,
      moneyBustedOver100: !!data?.money_busted_over100,
      // Profile.jsx's own money-tab stat tiles (see there) — same fields
      // PublicProfile.jsx fetches separately for viewing someone else.
      moneyWeeklyCents: data?.money_weekly_cents ?? 0,
      moneyBestWeeklyCents: data?.money_best_weekly_cents ?? 0,
      // Shop-only currency (see MoneyShop.jsx and resolve_money_push's
      // 10%-chance-per-combo-bar-fill roll) — rides along on this same
      // query since it's the same table/row, even though nothing outside
      // the shop itself ever displays it.
      moneyDiamonds: data?.money_diamonds ?? 0,
      // The shop's diamond-button push-button skin (see MoneyShop.jsx/
      // Home.jsx) — rides along on this same query for the same "same
      // table/row" reason moneyDiamonds does, even though it's read in
      // classic mode, not the shop itself.
      ownsDiamondButton: !!data?.owns_diamond_button,
      // Everything ELSE purchasable (auras, row styles — see
      // MoneyShop.jsx/cosmetics.js) and which of each independent slot is
      // currently equipped, if any (see active_push_skin/active_aura/
      // active_row_style's own comments in schema.sql).
      ownedCosmetics: data?.owned_cosmetics ?? [],
      activePushSkin: data?.active_push_skin ?? null,
      activeAura: data?.active_aura ?? null,
      activeRowStyle: data?.active_row_style ?? null,
      // Weekly money-mode bust insurance (see resolve_money_push's bust
      // branch in schema.sql for what owning it actually does).
      // insuranceUsedThisWeek resets to false every Monday alongside
      // moneyWeeklyCents (see api/weekly-money-reset.js).
      ownsInsurance: !!data?.owns_insurance,
      insuranceUsedThisWeek: !!data?.insurance_used_this_week,
    };
    setStats((prev) => ({ ...prev, ...next }));
    return next;
  }

  // Called by OnboardingModal.jsx when a logged-in player dismisses it —
  // only ever sets true, mirroring the column's own one-way semantics.
  async function markOnboardingSeen() {
    if (!user) return;
    setOnboardingSeenState(true); // optimistic, same reasoning as the carry-over above
    const { error } = await supabase.from('profiles').update({ onboarding_seen: true }).eq('id', user.id);
    if (error) console.error('failed to sync onboarding_seen:', error);
  }

  // Called by Home.jsx when MoneyModeUnlockModal.jsx is dismissed for
  // real (not the admin dev-tools preview, which never touches this) —
  // same optimistic-update shape as markOnboardingSeen above.
  async function markMoneyUnlockSeen() {
    if (!user) return;
    setMoneyUnlockSeenState(true);
    const { error } = await supabase.from('profiles').update({ money_unlock_seen: true }).eq('id', user.id);
    if (error) console.error('failed to sync money_unlock_seen:', error);
  }

  // Called by Home.jsx when PityIntroModal.jsx is dismissed for real (not
  // the admin dev-tools preview) — same optimistic-update shape as
  // markMoneyUnlockSeen above.
  async function markPityIntroSeen() {
    if (!user) return;
    setPityIntroSeenState(true);
    const { error } = await supabase.from('profiles').update({ pity_intro_seen: true }).eq('id', user.id);
    if (error) console.error('failed to sync pity_intro_seen:', error);
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
        // Lets MoneyMode.jsx pull a fresh money-badge-fields snapshot on
        // demand (see refreshMoneyStats above) — the login-time fetch
        // alone goes stale the instant a push/cash-out happens.
        refreshMoneyStats,
        // null = logged out, or logged in but not loaded yet — see
        // OnboardingModal.jsx, which treats null as "don't render yet".
        onboardingSeen,
        markOnboardingSeen,
        moneyUnlockSeen,
        markMoneyUnlockSeen,
        pityIntroSeen,
        markPityIntroSeen,
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
