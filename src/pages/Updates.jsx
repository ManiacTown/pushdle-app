import { spotlightMove } from '../lib/spotlight.js';
import { CHANGELOG } from '../lib/changelog.js';

// Formats a 'YYYY-MM-DD' string without going through `new Date(...)` +
// toLocaleDateString — that path re-interprets the date in the viewer's
// LOCAL timezone, which can roll a date-only string back a day for anyone
// west of UTC (the exact class of bug src/lib/pacificDate.js exists to
// avoid elsewhere in this app). Splitting the string keeps this a pure,
// timezone-independent format.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

export default function Updates() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ textAlign: 'center' }}>
        <h2 className="gradient-title" style={{ fontSize: 26, marginBottom: 8 }}>Updates - Dev Logbook</h2>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Everything that's changed since launch, newest first.
        </p>
      </div>

      {CHANGELOG.map((entry) => (
        <div key={entry.date} className="panel spotlight" onMouseMove={spotlightMove}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16 }}>{entry.title}</h3>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
              {formatDate(entry.date)}
            </span>
          </div>
          <ul className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, margin: 0, paddingLeft: 18 }}>
            {entry.items.map((item, i) => (
              <li key={i} style={{ marginBottom: i === entry.items.length - 1 ? 0 : 6 }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ textAlign: 'center' }}>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          More on the way!
        </p>
      </div>
    </div>
  );
}
