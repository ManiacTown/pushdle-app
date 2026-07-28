import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { spotlightMove } from '../lib/spotlight.js';

// Keeps usernames sane wherever they're displayed in tight spaces (nav bar,
// leaderboard rows, badge toasts) — letters/numbers/underscores only, so
// nothing shows up with spaces, emoji, or punctuation that could break
// those layouts or look like it's impersonating UI chrome.
const USERNAME_MAX_LENGTH = 20;
const sanitizeUsername = (value) => value.replace(/[^A-Za-z0-9_]/g, '').slice(0, USERNAME_MAX_LENGTH);

export default function Login() {
  const [mode, setMode] = useState('signIn'); // 'signIn' | 'signUp' | 'forgot'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [checkEmail, setCheckEmail] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { signIn, signUp, sendPasswordReset } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await sendPasswordReset(email.trim());
        setResetSent(true);
      } else if (mode === 'signUp') {
        // profiles.username is unique at the DB level (see schema.sql), but
        // that only surfaces as a generic "Database error saving new user"
        // from signUp — the trigger that inserts the profiles row fails,
        // rolling back the whole signup, with no mention of "username" in
        // sight. Checking first gives an actual answer instead of a dead
        // end. profiles is publicly readable (see schema.sql's RLS policy —
        // usernames already show on the leaderboard), so this is a plain
        // anon-safe read, no special access needed.
        const { data: existing } = await supabase.from('profiles').select('id').eq('username', username.trim()).maybeSingle();
        if (existing) {
          setError('That username is already taken.');
          return;
        }
        const data = await signUp(email.trim(), password, username.trim());
        if (data.session) {
          navigate('/profile');
        } else {
          // Project has email confirmation on — no session until they click
          // the link in their inbox.
          setCheckEmail(true);
        }
      } else {
        await signIn(email.trim(), password);
        navigate('/profile');
      }
    } catch (err) {
      // Two people signing up with the same username at nearly the same
      // instant can still both pass the pre-check above and race each
      // other to the actual insert — the DB constraint is what actually
      // prevents the duplicate in that case, just with the same unhelpful
      // generic message the pre-check exists to avoid. Give it a real
      // explanation instead of the raw "Database error saving new user".
      if (mode === 'signUp' && /database error saving new user/i.test(err.message)) {
        setError('That username was just taken — try another.');
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
        <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>Log in</h2>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Accounts aren't configured on this deployment yet — you can still play as a guest.
        </p>
      </div>
    );
  }

  if (checkEmail) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
        <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>Check your email</h2>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          We sent a confirmation link to {email}. Click it, then come back and log in.
        </p>
      </div>
    );
  }

  if (resetSent) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
        <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>Check your email</h2>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          If an account exists for {email}, we sent a link to reset your password.
        </p>
        <button
          className="btn-ghost"
          style={{ marginTop: 16, width: '100%' }}
          onClick={() => {
            setMode('signIn');
            setResetSent(false);
          }}
        >
          Back to log in
        </button>
      </div>
    );
  }

  return (
    <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
      <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>
        {mode === 'signUp' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Log in'}
      </h2>
      <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 20 }}>
        {mode === 'signUp'
          ? 'Save your streak and appear on the leaderboard.'
          : mode === 'forgot'
          ? "We'll email you a link to set a new password."
          : 'Welcome back.'}
      </p>
      <form onSubmit={handleSubmit}>
        {mode === 'signUp' && (
          <>
            <label className="sr-only" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
              maxLength={USERNAME_MAX_LENGTH}
              autoComplete="username"
              style={{ marginBottom: 12 }}
              required
            />
          </>
        )}
        <label className="sr-only" htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          style={{ marginBottom: mode === 'forgot' ? 16 : 12 }}
          required
        />
        {mode !== 'forgot' && (
          <>
            <label className="sr-only" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // signUp needs "new-password" (tells a password manager this
              // is a fresh credential to offer generating/saving, not one
              // to autofill) — signIn needs "current-password" instead.
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              style={{ marginBottom: 16 }}
              required
              minLength={6}
            />
          </>
        )}
        {mode === 'signIn' && (
          <button
            type="button"
            className="btn-ghost"
            style={{ marginBottom: 16, fontSize: 11, padding: '4px 0' }}
            onClick={() => {
              setMode('forgot');
              setError('');
            }}
          >
            Forgot password?
          </button>
        )}
        {error && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--neon-red)', marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '...' : mode === 'signUp' ? 'Sign up' : mode === 'forgot' ? 'Send reset link' : 'Continue'}
        </button>
      </form>
      <button
        className="btn-ghost"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() => {
          setMode(mode === 'signUp' ? 'signIn' : mode === 'forgot' ? 'signIn' : 'signUp');
          setError('');
        }}
      >
        {mode === 'signUp'
          ? 'Already have an account? Log in'
          : mode === 'forgot'
          ? 'Back to log in'
          : "Don't have an account? Sign up"}
      </button>
    </div>
  );
}
