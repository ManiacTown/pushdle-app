// Nitro Type-style gold tag: shown next to a player's username anywhere it
// renders, for as long as profiles.money_currently_top3 is true. Deliberately
// its own boolean rather than money_last_week_rank <= 3 — that column is
// sticky (see its own comment in schema.sql) and would leave this tag
// showing forever for someone who placed top 3 once and stopped playing.
// finalize_money_week clears money_currently_top3 for everyone before
// recomputing it fresh each week, so this tag automatically rotates to
// whoever actually placed top 3 the prior week, with no expiry logic of
// its own needed here.
export default function TopThreeTag() {
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '-0.02em',
        color: '#3a2a00',
        background: 'linear-gradient(135deg, #ffe27a, #ffb300)',
        border: '1px solid #ffd45e',
        borderRadius: 5,
        padding: '1px 5px',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        boxShadow: '0 0 6px rgba(255,212,94,0.5)',
      }}
    >
      $ Top 3
    </span>
  );
}
