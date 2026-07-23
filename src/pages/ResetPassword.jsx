import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { spotlightMove } from '../lib/spotlight.js';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const { user, updatePassword } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
        <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>Password updated</h2>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>
          You're all set.
        </p>
        <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/profile')}>
          Continue
        </button>
      </div>
    );
  }

  // The recovery link exchanges its token for a session on load (see
  // AuthContext) — `user` is undefined while that's still resolving, and
  // stays null if the link was invalid, already used, or expired.
  if (user === undefined) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
        <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>Link expired</h2>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 16 }}>
          This password reset link is invalid or has expired. Request a new one from the log in page.
        </p>
        <button className="btn-primary" style={{ width: '100%' }} onClick={() => navigate('/login')}>
          Back to log in
        </button>
      </div>
    );
  }

  return (
    <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 340, margin: '40px auto 0' }}>
      <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 6 }}>Set a new password</h2>
      <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 20 }}>
        Choose a new password for your account.
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ marginBottom: 12 }}
          required
          minLength={6}
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ marginBottom: 16 }}
          required
          minLength={6}
        />
        {error && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--neon-red)', marginBottom: 12 }}>
            {error}
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? '...' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
