import { spotlightMove } from '../lib/spotlight.js';

export default function Terms() {
  return (
    <div className="panel spotlight" onMouseMove={spotlightMove}>
      <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 18 }}>Terms of Service</h2>
      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.7 }}>
        <p style={{ marginBottom: 14, fontSize: 10 }}>Last updated: July 21, 2026</p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>1. Acceptance</strong><br />
          By creating an account or playing Pushdle, you agree to these terms. If you don't agree,
          please don't use the service.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>2. The service</strong><br />
          Pushdle is a free, for-entertainment-only daily game. There is no real-money wagering, no
          purchases, and no prizes — streaks and badges have no cash value and can't be redeemed,
          transferred, or sold.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>3. Eligibility</strong><br />
          Pushdle is available worldwide. You must be at least 13 years old to create an account —
          if you're under 13, you may only play as a guest, with no account and no data sent to us
          (see the Privacy Policy). If your local law sets a higher minimum age for agreeing to
          terms like these without a parent or guardian, that higher age applies to you instead.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>4. Accounts</strong><br />
          You're responsible for keeping your login credentials secure and for anything that
          happens under your account. Provide a real, working email address so you can receive
          account and password-reset emails. Usernames must not be offensive, misleading, or
          impersonate another person or the game itself.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>5. Fair play</strong><br />
          Don't attempt to manipulate your streak, leaderboard rank, or badges through automation,
          scripting, exploiting bugs, or creating multiple accounts. We may reset progress, remove
          leaderboard entries, or suspend accounts that do this.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>6. Your conduct</strong><br />
          Don't use Pushdle to harass others, attempt to access accounts or data that aren't yours,
          probe or attack the service (beyond good-faith security research reported responsibly),
          or use it for any unlawful purpose.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>7. Intellectual property</strong><br />
          The Pushdle name, design, and game content belong to us. Your account data and gameplay
          history belong to you, subject to our Privacy Policy governing how we store and use it.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>8. Termination</strong><br />
          You can stop using Pushdle and delete your account at any time (see the Privacy Policy
          for how). We may suspend or terminate accounts that violate these terms.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>9. Disclaimers</strong><br />
          Pushdle is provided "as is" and "as available," without warranties of any kind, express
          or implied. We don't guarantee the service will be uninterrupted, error-free, or that
          your data will never be lost — back up anything you care about elsewhere if that matters
          to you.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>10. Limitation of liability</strong><br />
          To the fullest extent permitted by law, we aren't liable for any indirect, incidental, or
          consequential damages arising from your use of Pushdle. Since the service is free, our
          total liability for any claim is limited to the amount you've paid us in the past 12
          months (i.e., $0).
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>11. Changes</strong><br />
          We may update these terms or the service itself at any time. We'll update the date above
          when we do; continued use after a change means you accept it.
        </p>

        <p style={{ marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>12. Governing law</strong><br />
          Pushdle is operated from California, USA, and these terms are governed by the laws of
          the State of California, without regard to conflict of law principles — regardless of
          where you access the service from. If you're a consumer in a jurisdiction that grants
          you non-waivable local consumer-protection rights, this section doesn't take those away
          from you.
        </p>

        <p>
          <strong style={{ color: 'var(--text)' }}>13. Contact</strong><br />
          Questions about these terms? Reach out via the Contact link in the footer.
        </p>
      </div>
    </div>
  );
}
