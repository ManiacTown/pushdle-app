import { spotlightMove } from '../lib/spotlight.js';

export default function Privacy() {
  return (
    <div className="panel spotlight" onMouseMove={spotlightMove}>
      <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 18 }}>Privacy Policy</h2>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
        <p style={{ marginBottom: 14, fontSize: 10 }}>Last updated: July 21, 2026</p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>1. Who we are</strong><br />
          Pushdle ("we", "us") is a small, independently-run daily game, operated from California,
          USA and available to players worldwide. This policy explains what data we collect when
          you use it, why, and what control you have over it.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>2. Information we collect</strong><br />
          <em style={{ color: 'var(--text)' }}>If you create an account:</em> your email address,
          the username you choose, and your password. Passwords are handled entirely by our
          authentication provider (Supabase) and stored as a salted hash — we never see or store
          it in plain text.<br /><br />
          <em style={{ color: 'var(--text)' }}>Gameplay data:</em> your daily streak, best streak,
          total pushes, and earned badges. For logged-in players this is stored in our database
          tied to your account, so it's available across devices and can appear on the
          leaderboard. If you play as a guest (no account), all of this stays in your browser's
          local storage only and is never sent to our servers.<br /><br />
          <em style={{ color: 'var(--text)' }}>We do not collect:</em> payment information (there's
          nothing to buy), location data, contacts, device identifiers, or any advertising/analytics
          data — Pushdle doesn't run ads or third-party analytics or tracking scripts of any kind.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>3. How we use your information</strong><br />
          Strictly to run the service: authenticating you, saving and restoring your daily run and
          badges, showing your chosen username on the leaderboard, and emailing you
          account-related messages (email confirmation, password reset). We don't use your data for
          advertising, don't build behavioral profiles, and don't sell or rent it to anyone.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>4. Cookies and local storage</strong><br />
          We don't use tracking or advertising cookies. We use your browser's local storage to keep
          you signed in and, for guest play, to store your run/streak data on your own device. This
          is functional storage, not tracking — it isn't shared with us or anyone else unless
          you're logged in and it's the gameplay data described above.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>5. Who we share it with</strong><br />
          We use two service providers to run Pushdle:<br />
          — <strong style={{ color: 'var(--text)' }}>Supabase</strong> hosts our database and
          handles authentication and account emails.<br />
          — <strong style={{ color: 'var(--text)' }}>Google Fonts</strong> serves the fonts used on
          this site; loading them causes your browser to make a request to Google's servers,
          which may log your IP address per Google's own policies.<br />
          Neither is used for advertising or given access to your data beyond what's needed to
          provide their service to us. We don't share your information with anyone else, and we
          don't sell it, ever.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>6. How long we keep it</strong><br />
          We keep your account and gameplay data for as long as your account exists. If you delete
          your account (see below), we delete the associated data within a reasonable time, except
          where we're required to retain it (e.g. to comply with a legal obligation).
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>7. Your rights</strong><br />
          You can ask us, at any time, to: see what data we hold about you, correct it, export it,
          or delete your account and data entirely. Reach out via the Contact link in the footer
          and we'll handle it directly — there's no self-service flow for this yet.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>8. California and other regional privacy rights</strong><br />
          We're based in California, so California's privacy law (the CCPA/CPRA) is a useful
          reference point regardless of where you live: we don't sell or "share" your personal
          information as those laws define it, and the rights described in Section 7 above (know,
          correct, delete, export) apply to everyone who uses Pushdle, not just California
          residents. If you're in the EU/UK, the same applies — we don't have a mechanism yet to
          formally appoint an EU representative or handle data-subject requests under GDPR-specific
          timelines, so if that matters to you, mention it when you contact us and we'll do our
          best to accommodate it.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>9. Children's privacy</strong><br />
          Pushdle isn't directed at children, and we don't knowingly collect data from anyone under
          13 (or the relevant minimum age in your jurisdiction). If you believe a child has created
          an account, contact us and we'll remove it.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>10. Security</strong><br />
          We rely on Supabase's infrastructure (encryption in transit, hashed passwords, and
          row-level database access rules) to protect your data. No system is perfectly secure, so
          we can't guarantee absolute security, but we don't store anything more sensitive than
          necessary to run the game.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>11. Changes to this policy</strong><br />
          If we make a material change to how we handle your data, we'll update this page and
          change the date above.
        </p>

        <p>
          <strong style={{ color: 'var(--text)' }}>12. Contact</strong><br />
          Questions or requests about your data: use the Contact link in the footer.
        </p>
      </div>
    </div>
  );
}
